import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Window } from 'happy-dom';

// 初始化 DOM 环境（happy-dom 提供 document/window 全局变量）
const window = new Window();
(globalThis as any).document = window.document;
(globalThis as any).window = window;
(globalThis as any).DOMParser = window.DOMParser;
(globalThis as any).XMLSerializer = window.XMLSerializer;

export interface Book {
  id: string;
  title: string;
  author?: string;
  filePath: string;
  format: 'epub' | 'txt' | 'html' | 'md';
  addedAt: number;
}

export interface ReadingProgress {
  bookId: string;
  pageIndex: number;
  percent: number;
  updatedAt: number;
}

/** 目录项（从 Reader.outline 扁平化，供 TocProvider 与 webview 共用） */
export interface TocEntry {
  title: string;
  nodeId: string;
  pageIndex: number;
  level: number;
  children: TocEntry[];
}

export class BookManager {
  private books: Book[] = [];
  private progress: Map<string, ReadingProgress> = new Map();
  private storagePath: string;
  private schema: any = null;

  /** 当前打开书籍的 Reader 实例（供 TocProvider 查询目录与跳转） */
  private currentReader: any = null;
  private currentBookId: string | null = null;
  /** 当前 webview panel（供 TOC 跳转时发送消息） */
  private currentPanel: vscode.WebviewPanel | null = null;
  /** 每个面板独立的 Reader 状态（多本书并行打开时目录/跳转各归其位） */
  private panelStates = new Map<vscode.WebviewPanel, { reader: any; bookId: string }>();
  /** Reader 就绪回调（供 TocProvider 刷新目录） */
  private onReaderReadyCallback: (() => void) | null = null;

  /** 自动翻页开关（状态栏控制，仅当 autoPageInterval > 0 时真正生效） */
  private autoPageOn = true;
  private autoPageStatusBar: vscode.StatusBarItem;

  /** 注册 Reader 就绪回调 */
  setOnReaderReady(callback: () => void): void {
    this.onReaderReadyCallback = callback;
  }

  /** 切换当前面板（取出该面板自己的 Reader，供目录与跳转使用） */
  private adoptPanel(panel: vscode.WebviewPanel | null): void {
    this.currentPanel = panel;
    const state = panel ? this.panelStates.get(panel) : undefined;
    this.currentReader = state?.reader ?? null;
    this.currentBookId = state?.bookId ?? null;
  }

  constructor(private context: vscode.ExtensionContext) {
    this.storagePath = path.join(context.globalStorageUri.fsPath, 'books');
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    this.loadLibrary();

    // 状态栏：自动翻页开关（底部右侧）
    const interval = vscode.workspace.getConfiguration('bioReader').get<number>('autoPageInterval', 0) || 0;
    this.autoPageOn = interval > 0;
    this.autoPageStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.autoPageStatusBar.command = 'bioReader.toggleAutoPage';
    this.updateAutoPageStatusBar();
    this.autoPageStatusBar.show();
    context.subscriptions.push(this.autoPageStatusBar);
  }

  private updateAutoPageStatusBar(): void {
    const config = vscode.workspace.getConfiguration('bioReader');
    const interval = config.get<number>('autoPageInterval', 0) || 0;
    if (interval <= 0) {
      this.autoPageStatusBar.text = '$(clock) 自动翻页';
      this.autoPageStatusBar.tooltip = '自动翻页未启用：请先在设置中配置 bioReader.autoPageInterval（秒）';
      return;
    }
    if (this.autoPageOn) {
      this.autoPageStatusBar.text = '$(debug-pause) 自动翻页';
      this.autoPageStatusBar.tooltip = '自动翻页中，点击暂停';
    } else {
      this.autoPageStatusBar.text = '$(play) 自动翻页';
      this.autoPageStatusBar.tooltip = '自动翻页已暂停，点击开始';
    }
  }

  /** 状态栏点击：切换自动翻页开/停，并通知当前 webview */
  toggleAutoPage(): void {
    this.autoPageOn = !this.autoPageOn;
    this.updateAutoPageStatusBar();
    this.currentPanel?.webview.postMessage({ type: 'autoPageControl', on: this.autoPageOn });
  }

  private async getSchema() {
    if (!this.schema) {
      const { buildClassicalEditorSchema } = await import('@bibliotype/classical/editor');
      this.schema = buildClassicalEditorSchema();
    }
    return this.schema;
  }

  private getLibraryPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'library.json');
  }

  private getProgressPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'progress.json');
  }

  private loadLibrary() {
    const libPath = this.getLibraryPath();
    if (fs.existsSync(libPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(libPath, 'utf-8'));
        this.books = data.books || [];
        this.progress = new Map(
          (data.progress || []).map((p: ReadingProgress) => [p.bookId, p])
        );
      } catch (e) {
        console.error('Failed to load library:', e);
      }
    }
  }

  private saveLibrary() {
    const data = {
      books: this.books,
      progress: Array.from(this.progress.values())
    };
    fs.writeFileSync(this.getLibraryPath(), JSON.stringify(data, null, 2));
  }

  async importBook(filePath: string): Promise<Book> {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!['epub', 'txt', 'html', 'htm', 'md'].includes(ext)) {
      throw new Error('不支持的格式');
    }

    const format = ext === 'htm' ? 'html' : ext as Book['format'];
    const fileName = path.basename(filePath);
    const title = path.basename(filePath, path.extname(filePath));
    const id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const bookPath = path.join(this.storagePath, `${id}_${fileName}`);
    fs.copyFileSync(filePath, bookPath);

    const book: Book = {
      id,
      title,
      filePath: bookPath,
      format,
      addedAt: Date.now()
    };

    this.books.push(book);
    this.saveLibrary();

    return book;
  }

  getBooks(): Book[] {
    return this.books;
  }

  getBookById(id: string): Book | undefined {
    return this.books.find(b => b.id === id);
  }

  removeBook(id: string) {
    const book = this.books.find(b => b.id === id);
    if (book) {
      if (fs.existsSync(book.filePath)) {
        fs.unlinkSync(book.filePath);
      }
      this.books = this.books.filter(b => b.id !== id);
      this.progress.delete(id);
      this.saveLibrary();
      if (this.currentBookId === id) {
        this.currentReader = null;
        this.currentBookId = null;
      }
    }
  }

  /** 获取当前 Reader 的目录数据（供 TocProvider 调用） */
  getTocEntries(): TocEntry[] {
    if (!this.currentReader) return [];
    return this.flattenOutline(this.currentReader.outline || []);
  }

  /** TOC 跳转：由 TocProvider 调用，向 webview 发送 goToPage 消息 */
  goToPage(pageIndex: number) {
    if (this.currentReader && this.currentPanel) {
      this.currentReader.goToPage(pageIndex);
      this.currentPanel.webview.postMessage({ type: 'goToPage', pageIndex });
    }
  }

  private flattenOutline(items: readonly any[], level = 0): TocEntry[] {
    const entries: TocEntry[] = [];
    for (const item of items) {
      const pageIndex = item.nodeId
        ? this.currentReader.getPageOfNode(item.nodeId) ?? 0
        : 0;
      const entry: TocEntry = {
        title: item.title || '(无标题)',
        nodeId: item.nodeId || '',
        pageIndex,
        level,
        children: this.flattenOutline(item.children || [], level + 1),
      };
      entries.push(entry);
    }
    return entries;
  }

  async openBook(book: Book) {
    const config = vscode.workspace.getConfiguration('bioReader');
    const customTitle = config.get<string>('panelTitle', '');
    const panelTitle = customTitle || `阅读: ${book.title}`;

    // 在光标当前激活的编辑器组打开（跟随窗口分栏焦点），无活动组时回落第一列
    const panel = vscode.window.createWebviewPanel(
      'ebookReader',
      panelTitle,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panelStates.set(panel, { reader: null, bookId: book.id });
    this.adoptPanel(panel);
    panel.webview.html = this.getWebviewContent(book);

    panel.webview.onDidReceiveMessage(
      async message => {
        if (message.type === 'ready') {
          // webview 就绪，带上尺寸信息 → 加载文档并分页
          await this.paginateAndSend(panel, book, message.width, message.height);
        } else if (message.type === 'resize') {
          // 窗口尺寸变化 → 重新分页
          await this.paginateAndSend(panel, book, message.width, message.height);
        } else if (message.type === 'saveProgress') {
          this.updateProgress(book.id, message.pageIndex, message.percent);
        }
      },
      undefined,
      this.context.subscriptions
    );

    // 面板激活（切回本书标签）时接管目录：目录始终跟随当前聚焦的阅读面板
    panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        this.adoptPanel(panel);
        this.onReaderReadyCallback?.();
      }
    });

    panel.onDidDispose(() => {
      this.panelStates.delete(panel);
      if (this.currentPanel === panel) {
        // 回落到仍打开的面板（最近创建者），没有则清空
        const remaining = [...this.panelStates.keys()];
        this.adoptPanel(remaining.length > 0 ? remaining[remaining.length - 1] : null);
        this.onReaderReadyCallback?.();
      }
    });
  }

  /** 加载文档、创建 Reader 分页、渲染所有页面并发送到 webview */
  private async paginateAndSend(
    panel: vscode.WebviewPanel,
    book: Book,
    viewWidth: number,
    viewHeight: number
  ) {
    const doc = await this.loadDocument(book);
    if (!doc) {
      panel.webview.postMessage({
        type: 'error',
        message: '无法加载文档'
      });
      return;
    }

    const config = vscode.workspace.getConfiguration('bioReader');
    const fontSize = config.get<number>('fontSize', 16);
    const lineHeight = config.get<number>('lineHeight', 1.8);
    const padding = config.get<number>('padding', 0);

    // 计算排版参数（与 demo use-reader-session 同口径）
    const lineSize = Math.round(fontSize * lineHeight);
    const contentWidth = Math.max(100, viewWidth - padding * 2);
    // 高度下限为一行：允许阅读窗缩到单行条带，不因 100px 钳制多打包而裁行
    const contentHeight = Math.max(lineSize, viewHeight - padding * 2);
    const charsPerLine = Math.max(1, Math.round((contentWidth / fontSize) * 0.95));
    const pageMainSize = contentHeight;

    try {
      const { Reader, DEFAULT_MEASURE_CONTEXT } = await import('@bibliotype/reader');

      const reader = new Reader({
        layout: {
          pageSize: { name: 'webview', width: viewWidth, height: viewHeight },
        },
        pageMainSize,
        measure: { charsPerLine, lineSize },
        // 页底剩一行也继续取一行，避免不足两行整段换页导致内容看不到
        widowControl: { minFirst: 1, minLast: 1 },
        // 关闭默认半行页底溢出：webview 无下边距，溢出行会被视口裁掉
        bottomSlack: 0,
      });

      reader.loadDocument(doc);
      // 面板级 Reader 登记：目录/跳转随面板切换各归其位
      const state = this.panelStates.get(panel);
      if (state) state.reader = reader;
      if (this.currentPanel === panel) {
        this.currentReader = reader;
        this.currentBookId = book.id;
      }
      // 目录就绪即通知 TocProvider（不等页面序列化，避免目录长时间空白）
      this.onReaderReadyCallback?.();

      // 渲染所有页面
      const totalPages = reader.totalPages;
      const pages: string[] = [];
      for (let i = 0; i < totalPages; i++) {
        const fragments = reader.getPageFragments(i);
        const { serializeNode } = await import('@bibliotype/layout/html');
        const html = fragments.map((f: any) => serializeNode(f)).join('');
        pages.push(html);
      }

      // 构建目录树
      const outline = this.flattenOutline(reader.outline || []);

      const savedPage = this.getProgress(book.id)?.pageIndex || 0;

      panel.webview.postMessage({
        type: 'bookData',
        pages,
        outline,
        currentPage: Math.min(savedPage, totalPages - 1),
        totalPages,
        autoPageOn: this.autoPageOn
      });
    } catch (e) {
      console.error('Pagination failed:', e);
      panel.webview.postMessage({
        type: 'error',
        message: `分页失败：${e}`
      });
    }
  }

  private updateProgress(bookId: string, pageIndex: number, percent: number) {
    this.progress.set(bookId, {
      bookId,
      pageIndex,
      percent,
      updatedAt: Date.now()
    });
    this.saveLibrary();
  }

  getProgress(bookId: string): ReadingProgress | undefined {
    return this.progress.get(bookId);
  }

  private async loadDocument(book: Book) {
    const schema = await this.getSchema();
    try {
      const metadata = { title: book.title };
      let doc;

      if (book.format === 'epub') {
        const { epubToBookDocument } = await import('@bibliotype/import-epub');
        const buffer = fs.readFileSync(book.filePath);
        doc = await epubToBookDocument(buffer, schema, metadata);
      } else {
        const { importFromText } = await import('@bibliotype/import');
        const text = fs.readFileSync(book.filePath, 'utf-8');
        const format = book.format === 'md' ? 'markdown' : book.format === 'html' ? 'html' : 'text';
        doc = importFromText(text, format, schema, metadata);
      }

      const { normalizeGlyphImages } = await import('@bibliotype/core');
      const { document: normalized } = normalizeGlyphImages(doc);
      return normalized;
    } catch (e) {
      console.error('Failed to load document:', e);
      return null;
    }
  }

  private getWebviewContent(book: Book): string {
    const config = vscode.workspace.getConfiguration('bioReader');
    const fontSize = config.get<number>('fontSize', 16);
    const lineHeight = config.get<number>('lineHeight', 1.8);
    const theme = config.get<string>('theme', 'dark');
    const padding = config.get<number>('padding', 0);
    const textIndent = config.get<number>('textIndent', 0);
    const bgColor = config.get<string>('backgroundColor', '');
    const textColor = config.get<string>('textColor', '');
    const linkColor = config.get<string>('linkColor', '');
    const customTitle = config.get<string>('panelTitle', '');
    const displayTitle = customTitle || book.title;
    // 自动翻页间隔（秒）：0 / 负值 / 非法值均视为不自动翻页
    const autoPageInterval = Math.max(0, Number(config.get<number>('autoPageInterval', 0)) || 0);
    const themeStyles = this.getThemeStyles(theme, bgColor, textColor, linkColor);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayTitle}</title>
  <style>
    ${themeStyles}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: ${fontSize}px;
      line-height: ${lineHeight};
      /* 长词 / 长串强制断行，避免窄窗格下溢出右缘被裁 */
      overflow-wrap: break-word; word-break: break-word;
    }
    body { padding: ${padding}px; }
    /* 进度条 */
    .progress-bar {
      position: fixed; top: 0; left: 0; right: 0;
      height: 3px; background: rgba(128,128,128,0.2); z-index: 1000;
    }
    .progress-fill { height: 100%; background: #007acc; transition: width 0.3s; }
    /* 页面容器：单页显示，无滚动 */
    #content {
      width: 100%; height: 100%;
      overflow: hidden;
      position: relative;
    }
    .page {
      display: none;
      width: 100%; height: 100%;
      overflow: hidden;
    }
    .page.active { display: block; }
    /* 点击区域（左右半屏翻页） */
    .click-zone {
      position: fixed; top: 0; bottom: 0;
      width: 35%; z-index: 100; cursor: pointer;
    }
    .click-zone.prev { left: 0; }
    .click-zone.next { right: 0; }
    /* 页码指示：固定右下角悬浮，小字号低调显示 */
    .page-indicator {
      position: fixed; bottom: 12px; right: 20px;
      font-size: 6px; line-height: 1; color: rgba(128,128,128,0.6);
      z-index: 1000; user-select: none; pointer-events: none;
    }
    /* 加载 / 错误 */
    .loading, .error {
      text-align: center; padding: 4em 2em;
      color: #888;
    }
    .error { color: #f44; }
    /* 内容样式（匹配 serializeNode 输出的 bt-* 类名） */
    .bt-book, .bt-volume, .bt-chapter, .bt-section { }
    .bt-paragraph { margin: 0.5em 0; text-indent: ${textIndent}em; }
    .bt-heading { margin: 1em 0 0.5em; }
    h1.bt-heading { font-size: 1.6em; text-align: center; margin: 1.5em 0 1em; }
    h2.bt-heading { font-size: 1.3em; }
    h3.bt-heading { font-size: 1.15em; }
    h4.bt-heading, h5.bt-heading, h6.bt-heading { font-size: 1em; }
    .bt-quote { margin: 1em 2em; color: inherit; opacity: 0.85; }
    .bt-list-item { margin: 0.2em 0; }
    .bt-code-block {
      background: rgba(128,128,128,0.1); padding: 0.8em;
      border-radius: 4px; font-family: monospace; font-size: 0.9em;
      white-space: pre-wrap; margin: 0.5em 0;
    }
    .bt-table { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
    .bt-table-row { }
    .bt-table-cell { border: 1px solid rgba(128,128,128,0.3); padding: 4px 8px; }
    a { color: #007acc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    /* 行内标记 */
    .bt-strong, strong { font-weight: bold; }
    .bt-em, em { font-style: italic; }
    .bt-code, code {
      font-family: monospace; background: rgba(128,128,128,0.1);
      padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="progress-bar">
    <div class="progress-fill" id="progressFill"></div>
  </div>
  <div id="content">
    <div class="loading">正在加载电子书...</div>
  </div>
  <div class="click-zone prev" id="clickPrev" title="上一页 (←↑)"></div>
  <div class="click-zone next" id="clickNext" title="下一页 (→↓)"></div>
  <div class="page-indicator" id="pageIndicator"></div>
  <script>
    const vscode = acquireVsCodeApi();
    let pages = [];
    let currentPage = 0;
    let totalPages = 0;

    /* ---------------- 自动翻页 ----------------
     * 间隔 > 0 时周期性翻到下一页；任何点击 / 按键 / 目录跳转都经 showPage
     * 重新计时（从当下重算 N 秒）；末页不再起定时器，自动停止。
     * 定时器句柄始终复用同一变量，先 clear 再设，不会累积泄漏。 */
    const AUTO_PAGE_MS = ${autoPageInterval} * 1000;
    let autoPageTimer = null;
    let autoPageOn = true;
    function stopAutoPageTimer() {
      if (autoPageTimer !== null) {
        clearTimeout(autoPageTimer);
        autoPageTimer = null;
      }
    }
    function resetAutoPageTimer() {
      stopAutoPageTimer();
      if (AUTO_PAGE_MS > 0 && autoPageOn && currentPage < totalPages - 1) {
        autoPageTimer = setTimeout(() => {
          autoPageTimer = null;
          showPage(currentPage + 1);
        }, AUTO_PAGE_MS);
      }
    }

    // 报告窗口尺寸
    function reportSize() {
      vscode.postMessage({
        type: 'ready',
        width: window.innerWidth,
        height: window.innerHeight
      });
    }

    // 初始报告
    reportSize();

    // 窗口尺寸变化
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        vscode.postMessage({
          type: 'resize',
          width: window.innerWidth,
          height: window.innerHeight
        });
      }, 300);
    });

    // 接收消息
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'bookData') {
        pages = msg.pages;
        totalPages = msg.totalPages;
        currentPage = msg.currentPage || 0;
        autoPageOn = msg.autoPageOn !== false;
        renderAllPages();
        showPage(currentPage);
      } else if (msg.type === 'goToPage') {
        showPage(msg.pageIndex);
      } else if (msg.type === 'autoPageControl') {
        autoPageOn = !!msg.on;
        if (autoPageOn) {
          resetAutoPageTimer();
        } else {
          stopAutoPageTimer();
        }
      } else if (msg.type === 'error') {
        document.getElementById('content').innerHTML =
          '<div class="error">' + msg.message + '</div>';
      }
    });

    function renderAllPages() {
      const content = document.getElementById('content');
      content.innerHTML = pages.map((html, i) =>
        '<div class="page" data-page="' + i + '">' + html + '</div>'
      ).join('');
    }

    function showPage(index) {
      if (index < 0 || index >= totalPages) return;
      currentPage = index;
      // 切换显示
      const allPages = document.querySelectorAll('.page');
      allPages.forEach((p, i) => {
        p.classList.toggle('active', i === index);
      });
      // 更新进度
      const percent = totalPages > 0 ? (index + 1) / totalPages : 0;
      document.getElementById('progressFill').style.width = (percent * 100) + '%';
      document.getElementById('pageIndicator').textContent =
        (index + 1) + ' / ' + totalPages;
      // 保存进度
      vscode.postMessage({
        type: 'saveProgress',
        pageIndex: index,
        percent: percent
      });
      // 重新计时自动翻页（点击 / 按键 / 跳转 / 自动翻页统一从当下重算）
      resetAutoPageTimer();
    }

    function nextPage() { showPage(currentPage + 1); }
    function prevPage() { showPage(currentPage - 1); }

    // 点击翻页
    document.getElementById('clickPrev').addEventListener('click', prevPage);
    document.getElementById('clickNext').addEventListener('click', nextPage);

    // 键盘翻页
    document.addEventListener('keydown', e => {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          prevPage();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          nextPage();
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  private getThemeStyles(theme: string, bgColor?: string, textColor?: string, linkColor?: string): string {
    const bg = bgColor || this.getDefaultBg(theme);
    const color = textColor || this.getDefaultColor(theme);
    const link = linkColor || this.getDefaultLink(theme);

    return `
      body { background: ${bg}; color: ${color}; }
      a { color: ${link}; }
    `;
  }

  private getDefaultBg(theme: string): string {
    switch (theme) {
      case 'light': return '#ffffff';
      case 'sepia': return '#f4ecd8';
      case 'dark':
      default: return '#1e1e1e';
    }
  }

  private getDefaultColor(theme: string): string {
    switch (theme) {
      case 'light': return '#333333';
      case 'sepia': return '#5b4636';
      case 'dark':
      default: return '#d4d4d4';
    }
  }

  private getDefaultLink(theme: string): string {
    switch (theme) {
      case 'light': return '#0066cc';
      case 'sepia': return '#8b4513';
      case 'dark':
      default: return '#569cd6';
    }
  }
}

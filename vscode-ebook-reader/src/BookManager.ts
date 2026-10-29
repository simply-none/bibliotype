import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface Book {
  id: string;
  title: string;
  author?: string;
  filePath: string;
  format: 'epub' | 'txt' | 'html' | 'md';
  coverUrl?: string;
  addedAt: number;
}

export interface ReadingProgress {
  bookId: string;
  location: string;
  percent: number;
  updatedAt: number;
}

export class BookManager {
  private books: Book[] = [];
  private progress: Map<string, ReadingProgress> = new Map();
  private currentBook: Book | null = null;
  private storagePath: string;

  constructor(private context: vscode.ExtensionContext) {
    this.storagePath = path.join(context.globalStorageUri.fsPath, 'books');
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    this.loadLibrary();
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
    }
  }

  openBook(book: Book) {
    this.currentBook = book;
    const panel = vscode.window.createWebviewPanel(
      'ebookReader',
      `阅读: ${book.title}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = this.getWebviewContent(book);

    panel.webview.onDidReceiveMessage(
      message => {
        if (message.type === 'saveProgress') {
          this.updateProgress(book.id, message.location, message.percent);
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  private updateProgress(bookId: string, location: string, percent: number) {
    this.progress.set(bookId, {
      bookId,
      location,
      percent,
      updatedAt: Date.now()
    });
    this.saveLibrary();
  }

  getProgress(bookId: string): ReadingProgress | undefined {
    return this.progress.get(bookId);
  }

  private getWebviewContent(book: Book): string {
    const config = vscode.workspace.getConfiguration('ebook-reader');
    const fontSize = config.get<number>('fontSize', 16);
    const lineHeight = config.get<number>('lineHeight', 1.8);
    const theme = config.get<string>('theme', 'dark');

    const progress = this.getProgress(book.id);
    const savedLocation = progress?.location || '';

    let content = '';
    try {
      const fileContent = fs.readFileSync(book.filePath, 'utf-8');
      if (book.format === 'txt') {
        content = `<pre>${this.escapeHtml(fileContent)}</pre>`;
      } else if (book.format === 'md') {
        content = this.renderMarkdown(fileContent);
      } else if (book.format === 'html') {
        content = fileContent;
      } else {
        content = `<p>EPUB 格式需要 epub.js 库支持，当前版本暂不支持</p>`;
      }
    } catch (e) {
      content = `<p>读取文件失败: ${e}</p>`;
    }

    const themeStyles = this.getThemeStyles(theme);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${book.title}</title>
  <style>
    ${themeStyles}
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: ${fontSize}px;
      line-height: ${lineHeight};
      padding: 2em;
      max-width: 800px;
      margin: 0 auto;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: rgba(128, 128, 128, 0.2);
      z-index: 1000;
    }
    .progress-fill {
      height: 100%;
      background: #007acc;
      transition: width 0.3s;
    }
  </style>
</head>
<body>
  <div class="progress-bar">
    <div class="progress-fill" id="progressFill"></div>
  </div>
  <div id="content">
    ${content}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const savedLocation = ${JSON.stringify(savedLocation)};
    
    if (savedLocation) {
      const element = document.querySelector(savedLocation);
      if (element) {
        element.scrollIntoView();
      }
    }

    let saveTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const percent = docHeight > 0 ? scrollTop / docHeight : 0;
        
        document.getElementById('progressFill').style.width = (percent * 100) + '%';
        
        vscode.postMessage({
          type: 'saveProgress',
          location: '#scroll-' + Math.round(scrollTop),
          percent: percent
        });
      }, 500);
    });

    window.addEventListener('load', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percent = docHeight > 0 ? scrollTop / docHeight : 0;
      document.getElementById('progressFill').style.width = (percent * 100) + '%';
    });
  </script>
</body>
</html>`;
  }

  private getThemeStyles(theme: string): string {
    switch (theme) {
      case 'light':
        return `
          body { background: #ffffff; color: #333333; }
          a { color: #0066cc; }
        `;
      case 'sepia':
        return `
          body { background: #f4ecd8; color: #5b4636; }
          a { color: #8b4513; }
        `;
      case 'dark':
      default:
        return `
          body { background: #1e1e1e; color: #d4d4d4; }
          a { color: #569cd6; }
        `;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private renderMarkdown(md: string): string {
    let html = md;
    
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>');
    
    html = html.replace(/^---$/gim, '<hr>');
    
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    return html;
  }
}

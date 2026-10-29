import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LibraryProvider } from './LibraryProvider.js';
import { TocProvider } from './TocProvider.js';
import { BookManager, Book } from './BookManager.js';

let bookManager: BookManager;
let libraryProvider: LibraryProvider;
let tocProvider: TocProvider;

export function activate(context: vscode.ExtensionContext) {
  try {
    bookManager = new BookManager(context);

    libraryProvider = new LibraryProvider(bookManager);
    tocProvider = new TocProvider(bookManager);

    // Reader 就绪后刷新目录
    bookManager.setOnReaderReady(() => tocProvider.refresh());

    vscode.window.registerTreeDataProvider('bioReader-library', libraryProvider);
    vscode.window.registerTreeDataProvider('bioReader-toc', tocProvider);
    console.log('bioReader 插件已激活');
  } catch (error) {
    console.error('插件激活失败:', error);
    vscode.window.showErrorMessage(`bioReader 激活失败：${error}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('bioReader.importBook', async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          '电子书': ['epub', 'txt', 'html', 'htm', 'md']
        }
      });

      if (result && result.length > 0) {
        const filePath = result[0].fsPath;
        try {
          await bookManager.importBook(filePath);
          libraryProvider.refresh();
          vscode.window.showInformationMessage('电子书导入成功');
        } catch (error) {
          vscode.window.showErrorMessage(`导入失败：${error}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bioReader.openBook', (book: Book) => {
      if (book) {
        bookManager.openBook(book);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bioReader.deleteBook', async (item: any) => {
      const book: Book | undefined = item?.book || item;
      if (!book || !book.id) return;
      
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除《${book.title}》吗？此操作不可恢复。`,
        { modal: true },
        '删除'
      );
      
      if (confirm === '删除') {
        bookManager.removeBook(book.id);
        libraryProvider.refresh();
        tocProvider.refresh();
        vscode.window.showInformationMessage(`已删除《${book.title}》`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bioReader.refreshLibrary', () => {
      libraryProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bioReader.showProgress', (book: Book) => {
      if (book) {
        const progress = bookManager.getProgress(book.id);
        if (progress) {
          vscode.window.showInformationMessage(
            `${book.title}: 阅读进度 ${Math.round(progress.percent * 100)}%`
          );
        }
      }
    })
  );

  // TOC 跳转命令：由 TocItem 的 command 触发
  context.subscriptions.push(
    vscode.commands.registerCommand('bioReader.goToTocPage', (pageIndex: number) => {
      if (typeof pageIndex === 'number') {
        bookManager.goToPage(pageIndex);
      }
    })
  );
}

export function deactivate() {}

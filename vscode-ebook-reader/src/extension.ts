import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LibraryProvider } from './LibraryProvider';
import { TocProvider } from './TocProvider';
import { BookManager, Book } from './BookManager';

let bookManager: BookManager;

export function activate(context: vscode.ExtensionContext) {
  bookManager = new BookManager(context);

  const libraryProvider = new LibraryProvider(bookManager);
  const tocProvider = new TocProvider(bookManager);

  vscode.window.registerTreeDataProvider('ebook-library', libraryProvider);
  vscode.window.registerTreeDataProvider('ebook-toc', tocProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('ebook-reader.importBook', async () => {
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
          vscode.window.showErrorMessage(`导入失败: ${error}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ebook-reader.openBook', (book: Book) => {
      if (book) {
        bookManager.openBook(book);
        tocProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ebook-reader.refreshLibrary', () => {
      libraryProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ebook-reader.showProgress', (book: Book) => {
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
}

export function deactivate() {}

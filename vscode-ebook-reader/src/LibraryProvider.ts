import * as vscode from 'vscode';
import { BookManager, Book } from './BookManager.js';

export class LibraryProvider implements vscode.TreeDataProvider<LibraryItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<LibraryItem | undefined | void> = new vscode.EventEmitter<LibraryItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<LibraryItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private bookManager: BookManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: LibraryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LibraryItem): Thenable<LibraryItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const books = this.bookManager.getBooks();
    const items = books.map(book => {
      const item = new LibraryItem(
        book.title,
        book,
        vscode.TreeItemCollapsibleState.None
      );
      item.command = {
        command: 'bioReader.openBook',
        title: '打开电子书',
        arguments: [book]
      };
      item.contextValue = 'book';
      item.tooltip = new vscode.MarkdownString(
        `**${book.title}**\n\n格式: ${book.format.toUpperCase()}\n\n添加时间: ${new Date(book.addedAt).toLocaleString()}`
      );
      
      const progress = this.bookManager.getProgress(book.id);
      if (progress) {
        item.description = `${Math.round(progress.percent * 100)}%`;
      }
      
      return item;
    });

    return Promise.resolve(items);
  }
}

class LibraryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly book: Book,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }

  iconPath = new vscode.ThemeIcon('book');
}

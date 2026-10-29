import * as vscode from 'vscode';
import { BookManager } from './BookManager';

export class TocProvider implements vscode.TreeDataProvider<TocItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TocItem | undefined | void> = new vscode.EventEmitter<TocItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TocItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private bookManager: BookManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TocItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TocItem): Thenable<TocItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const items = [
      new TocItem('暂无目录信息', vscode.TreeItemCollapsibleState.None)
    ];

    return Promise.resolve(items);
  }
}

class TocItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }

  iconPath = new vscode.ThemeIcon('list-tree');
}

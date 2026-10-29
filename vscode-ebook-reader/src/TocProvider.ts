import * as vscode from 'vscode';
import { BookManager, type TocEntry } from './BookManager.js';

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
    const entries = this.bookManager.getTocEntries();
    if (entries.length === 0) {
      return Promise.resolve([
        new TocItem('暂无目录信息', '', 0, vscode.TreeItemCollapsibleState.None)
      ]);
    }

    if (element) {
      return Promise.resolve(
        element.children.map(entry => toTocItem(entry))
      );
    }

    return Promise.resolve(
      entries.map(entry => toTocItem(entry))
    );
  }
}

function toTocItem(entry: TocEntry): TocItem {
  const hasChildren = entry.children.length > 0;
  const collapsible = hasChildren
    ? vscode.TreeItemCollapsibleState.Collapsed
    : vscode.TreeItemCollapsibleState.None;

  const item = new TocItem(
    entry.title,
    entry.nodeId,
    entry.pageIndex,
    collapsible,
    entry.children
  );

  // 点击跳转到对应页面
  item.command = {
    command: 'ebook-reader.goToTocPage',
    title: '跳转到目录页',
    arguments: [entry.pageIndex]
  };

  item.description = `p.${entry.pageIndex + 1}`;
  item.tooltip = `${entry.title} (第 ${entry.pageIndex + 1} 页)`;

  return item;
}

export class TocItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly nodeId: string,
    public readonly pageIndex: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: TocEntry[] = []
  ) {
    super(label, collapsibleState);
  }

  iconPath = new vscode.ThemeIcon('bookmark');
}

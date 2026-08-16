export type RestorableWorkspaceMode = 'review' | 'train' | 'lines';

export class WorkspaceSnapshotStore<Snapshot> {
  private readonly snapshots = new Map<RestorableWorkspaceMode, Snapshot>();

  load(mode: RestorableWorkspaceMode) {
    return this.snapshots.get(mode) ?? null;
  }

  remove(mode: RestorableWorkspaceMode) {
    this.snapshots.delete(mode);
  }

  save(mode: RestorableWorkspaceMode, snapshot: Snapshot) {
    this.snapshots.set(mode, snapshot);
  }

  clear() {
    this.snapshots.clear();
  }
}

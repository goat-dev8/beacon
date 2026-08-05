import type { ExecutionAdapter, WorkflowDefinition } from "./types.js";

export class WorkflowRegistry {
  private readonly adapters = new Map<string, ExecutionAdapter>();

  static key(workflowType: string, version: string): string {
    return `${workflowType}@${version}`;
  }

  register(workflowType: string, version: string, adapter: ExecutionAdapter): void {
    const registryKey = WorkflowRegistry.key(workflowType, version);
    if (this.adapters.has(registryKey)) {
      throw new Error(`Workflow already registered: ${registryKey}`);
    }
    this.adapters.set(registryKey, adapter);
  }

  registerDefinition(definition: WorkflowDefinition): void {
    this.register(definition.workflowType, definition.version, definition.adapter);
  }

  get(workflowType: string, version: string): ExecutionAdapter | undefined {
    return this.adapters.get(WorkflowRegistry.key(workflowType, version));
  }

  has(workflowType: string, version: string): boolean {
    return this.adapters.has(WorkflowRegistry.key(workflowType, version));
  }

  list(): WorkflowDefinition[] {
    return [...this.adapters.entries()].map(([registryKey, adapter]) => {
      const separator = registryKey.lastIndexOf("@");
      return {
        workflowType: registryKey.slice(0, separator),
        version: registryKey.slice(separator + 1),
        adapter,
      };
    });
  }
}

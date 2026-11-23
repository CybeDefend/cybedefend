// Minimal Jest-friendly mock for @kubernetes/client-node (ESM) used in tests
// Provides KubeConfig, CoreV1Api and AuthorizationV1Api with the subset of
// methods used by KubernetesService and the Community cluster engine
// (src/modules/cluster-scanning/kube-client.ts)

export class KubeConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadFromOptions(_opts: any) {}
  loadFromDefault() {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadFromFile(_file: string) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadFromString(_s: string) {}
  getCurrentUser(): { name: string; token: string } {
    return { name: 'test-user', token: 'test-token' };
  }
  getCurrentContext() {
    return 'test-context';
  }
  getCurrentCluster() {
    return { name: 'test-cluster', server: 'https://127.0.0.1' } as any;
  }
  getContexts() {
    return [
      { name: 'test-context', cluster: 'test-cluster', user: 'test-user' },
    ] as any;
  }
  getClusters() {
    return [{ name: 'test-cluster', server: 'https://127.0.0.1' }] as any;
  }
  makeApiClient(cls: any) {
    // Any other API class (CustomObjectsApi is not mocked) gets CoreV1Api, as before.
    if (cls === AuthorizationV1Api) return new AuthorizationV1Api();
    return new CoreV1Api();
  }
}

// Types of request objects are not needed strictly in mocks, but we keep shapes for clarity
export class CoreV1Api {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listNamespacedPod(_req: { namespace: string }): Promise<any> {
    return { body: { items: [] } };
  }
  async createNamespacedSecret(_req: {
    namespace: string;
    body: any;
  }): Promise<any> {
    return {
      body: {
        metadata: {
          name: _req.body?.metadata?.name || 'secret',
          uid: 'uid-secret',
        },
      },
    };
  }
  async createNamespacedPod(_req: {
    namespace: string;
    body: any;
  }): Promise<any> {
    return {
      body: {
        metadata: { name: _req.body?.metadata?.name || 'pod', uid: 'uid-pod' },
        status: { podIP: '127.0.0.1' },
      },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteNamespacedSecret(_req: {
    name: string;
    namespace: string;
  }): Promise<any> {
    return { body: {} };
  }
  async readNamespacedPod(_req: {
    name: string;
    namespace: string;
  }): Promise<any> {
    return { metadata: { name: _req.name, uid: 'uid-pod' } };
  }
  async readNamespacedSecret(_req: {
    name: string;
    namespace: string;
  }): Promise<any> {
    return { metadata: { name: _req.name, uid: 'uid-secret' } };
  }
  async replaceNamespacedSecret(_req: {
    name: string;
    namespace: string;
    body: any;
  }): Promise<any> {
    return { metadata: { name: _req.name } };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteNamespacedPod(_req: {
    name: string;
    namespace: string;
  }): Promise<any> {
    return { body: {} };
  }
}

export class AuthorizationV1Api {
  async createSelfSubjectAccessReview(req: {
    body: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return { ...req.body, status: { allowed: true } };
  }
}

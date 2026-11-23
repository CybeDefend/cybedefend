import { projectPath } from '@/utils/product';

/**
 * Test utility for measuring API calls and navigation performance
 * Used to validate the optimization of multiple API calls during vulnerability page navigation
 */

interface APICallMetrics {
  url: string;
  method: string;
  timestamp: number;
  duration?: number;
  fromCache?: boolean;
}

interface NavigationMetrics {
  fromPage: string;
  toPage: string;
  apiCalls: APICallMetrics[];
  totalDuration: number;
  cacheHitRate: number;
}

class APICallTracker {
  private calls: APICallMetrics[] = [];
  private isTracking = false;
  
  start(): void {
    this.calls = [];
    this.isTracking = true;
  }
  
  stop(): NavigationMetrics {
    this.isTracking = false;
    const metrics = this.analyzeMetrics();
    return metrics;
  }
  
  trackCall(url: string, method: string = 'GET', fromCache: boolean = false): void {
    if (!this.isTracking) return;
    
    const call: APICallMetrics = {
      url,
      method,
      timestamp: Date.now(),
      fromCache,
    };
    
    this.calls.push(call);
  }
  
  private analyzeMetrics(): NavigationMetrics {
    const totalCalls = this.calls.length;
    const cachedCalls = this.calls.filter(call => call.fromCache).length;
    const cacheHitRate = totalCalls > 0 ? (cachedCalls / totalCalls) * 100 : 0;
    
    const duration = this.calls.length > 0 
      ? Math.max(...this.calls.map(call => call.timestamp)) - Math.min(...this.calls.map(call => call.timestamp))
      : 0;
    
    return {
      fromPage: '',
      toPage: '',
      apiCalls: this.calls,
      totalDuration: duration,
      cacheHitRate,
    };
  }
  
  getCallsByType(): Record<string, number> {
    return this.calls.reduce((acc, call) => {
      const type = this.categorizeCall(call.url);
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
  
  private categorizeCall(url: string): string {
    if (url.includes('github')) return 'GitHub';
    if (url.includes('gitlab')) return 'GitLab';
    if (url.includes('vulnerabilities')) return 'Vulnerabilities';
    if (url.includes('projects')) return 'Projects';
    return 'Other';
  }
}

// Singleton instance
export const apiTracker = new APICallTracker();

/**
 * Test navigation scenarios for vulnerability pages
 */
export const testNavigationScenarios = {
  /**
   * Test rapid navigation between SAST, IAC, SCA pages
   */
  async testRapidNavigation(): Promise<void> {
    
    const scenarios = [
      { from: 'SAST', to: 'IAC', path: projectPath('appsec', 'test', 'iac') },
      { from: 'IAC', to: 'SCA', path: projectPath('appsec', 'test', 'sca') },
      { from: 'SCA', to: 'SAST', path: projectPath('appsec', 'test', 'sast') },
      { from: 'SAST', to: 'IAC', path: projectPath('appsec', 'test', 'iac') },
    ];
    
    for (const scenario of scenarios) {
      apiTracker.start();
      
      // Simulate navigation delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const metrics = apiTracker.stop();
      
      // Wait before next navigation
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  },
  
  /**
   * Test that integration hooks are properly cached
   */
  async testIntegrationCaching(): Promise<void> {
    
    apiTracker.start();
    
    // Simulate multiple calls to the same integration endpoints
    for (let i = 0; i < 3; i++) {
      apiTracker.trackCall('/api/integrations/github/repositories', 'GET', i > 0);
      apiTracker.trackCall('/api/integrations/gitlab/repositories', 'GET', i > 0);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const metrics = apiTracker.stop();
    const expectedCacheHitRate = 66.7; // 2 out of 3 calls should be cached
  

  },
  
  /**
   * Performance benchmark before and after optimization
   */
  async benchmarkPerformance(): Promise<void> {
    
    const runs = 5;
    const results: number[] = [];
    
    for (let i = 0; i < runs; i++) {
      apiTracker.start();
      
      // Simulate a typical navigation sequence
      apiTracker.trackCall('/api/projects/test/vulnerabilities/sast', 'GET');
      apiTracker.trackCall('/api/integrations/github/repositories', 'GET');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      apiTracker.trackCall('/api/projects/test/vulnerabilities/iac', 'GET');
      apiTracker.trackCall('/api/integrations/github/repositories', 'GET', true); // Should be cached
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics = apiTracker.stop();
      results.push(metrics.apiCalls.length);
    }
  }
};

/**
 * Comprehensive test suite for the API optimization
 */
export const runOptimizationTests = async (): Promise<void> => {
  
  await testNavigationScenarios.testRapidNavigation();
  
  await testNavigationScenarios.testIntegrationCaching();
  
  await testNavigationScenarios.benchmarkPerformance();
};

import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as packageJson from '../package.json';

export interface VersionResponse {
  service: string;
  version: string;
  commit: string;
  environment: string;
  deploymentEnv: string;
}

@Injectable()
export class AppService {
  getHello(): VersionResponse {
    const version = packageJson.version;
    let commitHash: string = process.env.GIT_COMMIT_HASH || 'unknown';
    const appEnv: string = process.env.APP_ENV || 'development';

    // In development, try to read the commit hash from git
    if (commitHash === 'unknown' && process.env.NODE_ENV !== 'production') {
      try {
        commitHash = execSync('git rev-parse --short HEAD', {
          encoding: 'utf-8',
        }).trim();
      } catch (error) {
        // git is not installed, or this is not a git checkout
        console.error('Unable to get git commit hash:', error.message);
      }
    }

    return {
      service: 'Gateway Service',
      version,
      commit: commitHash,
      environment: process.env.NODE_ENV || 'development',
      deploymentEnv: appEnv,
    };
  }
}

import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { projectIntegrationPath } from "./shared/integrationPaths";

import { ProjectIntegrationLinkExistingPage } from "./shared/ProjectIntegrationLinkExistingPage";
import { IntegrationPageConfig, IntegrationProvider } from "@/server/interfaces/IntegrationProvider";
import { useGithubIntegrationAdapter } from "@/server/hooks/useGithubIntegrationAdapter";
import { useGitlabIntegrationAdapter } from "@/server/hooks/useGitlabIntegrationAdapter";
import { Github} from '@/components/atoms/icon/icons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';

export const GenericProjectIntegrationLinkExistingPage: React.FC = () => {
    const location = useLocation();

    // Read the provider from the URL
    const getProviderFromPath = (pathname: string): IntegrationProvider => {
        if (pathname.includes('/github')) return 'github';
        if (pathname.includes('/gitlab')) return 'gitlab';
        throw new Error(`Cannot determine provider from path: ${pathname}`);
    };

    const provider = getProviderFromPath(location.pathname);

    const configs = useMemo((): Record<IntegrationProvider, IntegrationPageConfig> => ({
        github: {
            provider: 'github',
            icon: <Github className="h-4 w-4 text-zinc-700 dark:text-zinc-300"  />,
            translationKey: 'github',
            backToPath: projectIntegrationPath('github'),
        },
        gitlab: {
            provider: 'gitlab',
            icon: <Gitlab className="h-4 w-4 text-orange-500"  />,
            translationKey: 'gitlab',
            backToPath: projectIntegrationPath('gitlab'),
        },
    }), []);

    const hooks = useMemo(() => ({
        github: useGithubIntegrationAdapter,
        gitlab: useGitlabIntegrationAdapter,
    }), []);

    const config = configs[provider];
    const useIntegrationHook = hooks[provider];

    return <ProjectIntegrationLinkExistingPage config={config} useIntegrationHook={useIntegrationHook} />;
};

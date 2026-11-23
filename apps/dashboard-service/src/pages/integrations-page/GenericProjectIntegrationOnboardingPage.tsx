import React from "react";
import { useLocation } from "react-router-dom";
import { productHome } from "@/utils/product";

import { ProjectIntegrationOnboardingPage } from "./shared/ProjectIntegrationOnboardingPage";
import { IntegrationPageConfig, IntegrationProvider } from "@/server/interfaces/IntegrationProvider";
import { useGithubIntegrationAdapter } from "@/server/hooks/useGithubIntegrationAdapter";
import { useGitlabIntegrationAdapter } from "@/server/hooks/useGitlabIntegrationAdapter";
import { Github} from '@/components/atoms/icon/icons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';

export const GenericProjectIntegrationOnboardingPage: React.FC = () => {
    const location = useLocation();

    // Read the provider from the URL
    const getProviderFromPath = (pathname: string): IntegrationProvider => {
        if (pathname.includes('/github')) return 'github';
        if (pathname.includes('/gitlab')) return 'gitlab';
        throw new Error(`Cannot determine provider from path: ${pathname}`);
    };

    const provider = getProviderFromPath(location.pathname);

    // The import is an AppSec page: « back to home » is the AppSec home, not the root the landing rule decides.
    const configs: Record<IntegrationProvider, IntegrationPageConfig> = {
        github: {
            provider: 'github',
            icon: <Github className="h-6 w-6 text-zinc-700 dark:text-zinc-300"  />,
            translationKey: 'github',
            backToPath: productHome('appsec'),
        },
        gitlab: {
            provider: 'gitlab',
            icon: <Gitlab className="h-6 w-6 text-orange-600"  />,
            translationKey: 'gitlab',
            backToPath: productHome('appsec'),
        },
    };

    const hooks = {
        github: useGithubIntegrationAdapter,
        gitlab: useGitlabIntegrationAdapter,
    };

    const config = configs[provider];
    const useIntegrationHook = hooks[provider];

    return <ProjectIntegrationOnboardingPage config={config} useIntegrationHook={useIntegrationHook} />;
};

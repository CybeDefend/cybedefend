import { Integration } from "../../server/interfaces/Project";

// Logos that are monochrome black-on-transparent artwork (GitHub octocat, the
// CLI terminal glyph, the API gear, the Cybe MCP swirl, the Windsurf wave, the
// Copilot head, the compliance block).
// On the dark-mode integration card (`dark:bg-neutral-900`) they render
// near-black-on-near-black and disappear, so the card applies `dark:invert` to
// flip them to white. Keyed on the asset path — not the integration name —
// because some images (notably github.png) back several integrations at once.
// Coloured brand logos (GitLab, Jira, Slack, Docker, the JetBrains family, the
// Claude Code mascot, the Codex gradient, Linear…) and the grey gradient
// Cursor cube are intentionally excluded: inverting them would distort their
// colours rather than fix visibility.
export const MONOCHROME_DARK_LOGOS: ReadonlySet<string> = new Set([
  "/image/integrations/github.png",
  "/image/integrations/cli.png",
  "/image/integrations/api.png",
  "/image/integrations/mcp.png",
  "/image/integrations/windsurf.png",
  "/image/integrations/copilot.svg",
  "/image/integrations/compai.svg",
]);

export const isMonochromeDarkLogo = (imgSrc: string): boolean =>
  MONOCHROME_DARK_LOGOS.has(imgSrc);

export const categories = [
    { id: "all", label: "All Integrations" },
    { id: "code_repository", label: "Code Repository" },
    { id: "agent_ai", label: "Agent AI" },
    { id: "ide_plugins", label: "IDE Plugins" },
    { id: "container_registries", label: "Container registries" },
    { id: "continuous_integration", label: "Continuous integration" },
    { id: "issue_tracking", label: "Issue Tracking" },
    { id: "notifications", label: "Notifications" },
    { id: "compliance", label: "Compliance" },
    //{ id: "container_orchestrators", label: "Container orchestrators" },
  ];

/** A card of the organisation's integration catalogue; a product space adds its own (`ProductSpace.integrationCards`). */
export type IntegrationCard = Integration;

export const integrations: Integration[] = [
    
    {
      name: "GitHub",
      imgSrc: "/image/integrations/github.png",
      category: "Code Repository",
      available: true,
    },
    {
      name: "GitLab",
      imgSrc: "/image/integrations/gitlab.png",
      category: "Code Repository",
      available: true,
    },
    // {
    //   name: "Bitbucket",
    //   imgSrc: "/image/integrations/bitbucket.png",
    //   category: "Code Repository",
    //   available: true,
    // },
    // {
    //   name: "GitHub Server",
    //   imgSrc: "/image/integrations/github.png",
    //   category: "Code Repository",
    //   available: false,
    // },
    // {
    //   name: "GitLab self-managed",
    //   imgSrc: "/image/integrations/gitlab.png",
    //   category: "Code Repository",
    //   available: false,
    // },

    {
      name: "Cybe MCP",
      imgSrc: "/image/integrations/mcp.png",
      category: "Agent AI",
      available: true,
      link: "https://docs.cybedefend.com/latest/plateform-overview/key-features/mcp-server-integration#cybe-mcp-server",
    },
    {
      name: "Visual Studio Code",
      imgSrc: "/image/integrations/vscode.png",
      category: "IDE Plugins",
      available: true,
      link: "https://marketplace.visualstudio.com/items?itemName=CybeDefend.cybedefend",
    },
    {
      name: "Cursor",
      imgSrc: "/image/integrations/cursor.png",
      category: "IDE Plugins",
      available: true,
    },
    {
      name: "Windsurf",
      imgSrc: "/image/integrations/windsurf.png",
      category: "IDE Plugins",
      available: true,
      link: "https://open-vsx.org/extension/cybedefend/cybedefend",
    },
    {
      name: "Antigravity",
      imgSrc: "/image/integrations/antigravity.png",
      category: "IDE Plugins",
      available: true,
      link: "https://open-vsx.org/extension/cybedefend/cybedefend",
    },
    {
      name: "PhpStorm",
      imgSrc: "/image/integrations/phpstorm.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "IntelliJ",
      imgSrc: "/image/integrations/intellij.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "AppCode",
      imgSrc: "/image/integrations/appcode.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "WebStorm",
      imgSrc: "/image/integrations/webstorm.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "PyCharm",
      imgSrc: "/image/integrations/pycharm.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "DataGrip",
      imgSrc: "/image/integrations/datagrip.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "Rider",
      imgSrc: "/image/integrations/rider.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "CLion",
      imgSrc: "/image/integrations/clion.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "RustRover",
      imgSrc: "/image/integrations/rustover.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "GoLand",
      imgSrc: "/image/integrations/goland.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    {
      name: "RubyMine",
      imgSrc: "/image/integrations/rubymine.png",
      category: "IDE Plugins",
      link: "https://plugins.jetbrains.com/plugin/27580-cybedefend",
      available: true,
    },
    // {
    //   name: "Eclipse",
    //   imgSrc: "/image/integrations/eclipse.png",
    //   category: "IDE Plugins",
    //   available: false,
    // },
    
    {
      name: "Docker Hub",
      imgSrc: "/image/integrations/dockerhub.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "GitLab Registry",
      imgSrc: "/image/integrations/gitlab.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "GCR",
      imgSrc: "/image/integrations/gcr.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "GitHub Container Registry",
      imgSrc: "/image/integrations/github.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "ECR",
      imgSrc: "/image/integrations/ecr.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "ACR",
      imgSrc: "/image/integrations/acr.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "Quay",
      imgSrc: "/image/integrations/quay.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "Harbor",
      imgSrc: "/image/integrations/harbor.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "JFrog Artifactory",
      imgSrc: "/image/integrations/jfrog.png",
      category: "Container registries",
      available: true,
    },
    {
      name: "Scaleway",
      imgSrc: "/image/integrations/scaleway.png",
      category: "Container registries",
      available: true,
    },
    
    {
      name: "CLI",
      imgSrc: "/image/integrations/cli.png",
      category: "Continuous integration",
      available: true,
      link: "https://github.com/CybeDefend/cybedefend-cli",
    },
    {
      name: "CybeDefend API",
      imgSrc: "/image/integrations/api.png",
      category: "Continuous integration",
      available: true,
      link: "https://docs.cybedefend.com/latest/api-reference/introduction",
    },
    {
      name: "GitHub Actions",
      imgSrc: "/image/integrations/github.png",
      category: "Continuous integration",
      available: true,
      link: "https://github.com/CybeDefend/cybedefend-action",
    },

    {
      name: "GitHub Issues",
      imgSrc: "/image/integrations/github.png",
      category: "Issue Tracking",
      available: true,
    },
    {
      name: "GitLab Issues",
      imgSrc: "/image/integrations/gitlab.png",
      category: "Issue Tracking",
      available: true,
    },
    // {
    //   name: "GitLab CI",
    //   imgSrc: "/image/integrations/gitlab.png",
    //   category: "Continuous integration",
    //   available: false,
    // },
    // {
    //   name: "Jenkins",
    //   imgSrc: "/image/integrations/jenkins.png",
    //   category: "Continuous integration",
    //   available: false,
    // },
    // {
    //   name: "Azure Pipelines",
    //   imgSrc: "/image/integrations/azure-pipeline.png",
    //   category: "Continuous integration",
    //   available: false,
    // },
    // {
    //   name: "AWS CodePipeline",
    //   imgSrc: "/image/integrations/aws.png",
    //   category: "Continuous integration",
    //   available: false,
    // },
    // {
    //   name: "Google Cloud Build",
    //   imgSrc: "/image/integrations/gcb.png",
    //   category: "Continuous integration",
    //   available: false,
    // },
    // {
    //   name: "Circle CI",
    //   imgSrc: "/image/integrations/circle-cli.png",
    //   category: "Continuous integration",
    //   available: false,
    // },
    // {
    //   name: "Travis CI",
    //   imgSrc: "/image/integrations/travis-cli.png",
    //   category: "Continuous integration",
    //   available: false,
    // },    
    {
      name: "Jira",
      imgSrc: "/image/integrations/jira.png",
      category: "Issue Tracking",
      available: true,
    },
    {
      name: "Linear",
      imgSrc: "/image/integrations/linear.svg",
      category: "Issue Tracking",
      available: true,
    },
    // {
    //   name: "GitLab Issues",
    //   imgSrc: "/image/integrations/gitlab.png",
    //   category: "Notifications & Ticketing",
    //   available: false,
    // },
    {
      name: "Slack",
      imgSrc: "/image/integrations/slack.png",
      category: "Notifications",
      available: true,
    },

    {
      name: "Comp AI",
      imgSrc: "/image/integrations/compai.svg",
      category: "Compliance",
      available: true,
      link: "https://www.trycomp.ai/",
    },
    
    // {
    //   name: "Kubernetes",
    //   imgSrc: "/image/integrations/kubernetes.png",
    //   category: "Container orchestrators",
    //   available: true,
    // },
    // {
    //   name: "GKE",
    //   imgSrc: "/image/integrations/gke.png",
    //   category: "Container orchestrators",
    //   available: true,
    // },
    // {
    //   name: "EKS",
    //   imgSrc: "/image/integrations/eks.png",
    //   category: "Container orchestrators",
    //   available: true,
    // },
    // {
    //   name: "AKS",
    //   imgSrc: "/image/integrations/aks.png",
    //   category: "Container orchestrators",
    //   available: true,
    // },
  ];
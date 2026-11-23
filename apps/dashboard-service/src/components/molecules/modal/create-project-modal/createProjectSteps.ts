import type { ComponentType } from 'react';

/** Where the wizard takes the project from: a repository of a provider, or none. */
export type CreateProjectSource = 'manual' | 'github' | 'gitlab';

/** What a space's step receives once the project exists (`ProductSpace.createProjectSteps`). */
export interface CreateProjectStepProps {
  projectId: string | null;
  organizationId: string;
  /** The source the project was created from. */
  source: CreateProjectSource;
  onNext(): void;
  onBack(): void;
}

/** A step a product space adds to the wizard, after the creation. */
export interface CreateProjectStep {
  id: string;
  order: number;
  /** The space the step belongs to. */
  product: string;
  Component: ComponentType<CreateProjectStepProps>;
}

/** A step of the core's wizard: the form a source walks through before the creation. */
export interface CoreCreateProjectStep {
  id: 'repository' | 'basics' | 'securityContext';
  /** Key of its title in the step indicator. */
  titleKey: string;
  /** The sources that walk through it. */
  sources: readonly CreateProjectSource[];
}

/** The core's steps, in order: the repository picker, the project basics, the security context. */
export const CORE_CREATE_PROJECT_STEPS: readonly CoreCreateProjectStep[] = [
  { id: 'repository', titleKey: 'components.modal.createProject.step1Title', sources: ['github', 'gitlab'] },
  { id: 'basics', titleKey: 'components.modal.createProject.step2Title', sources: ['manual', 'github', 'gitlab'] },
  {
    id: 'securityContext',
    titleKey: 'components.modal.createProject.step3Title',
    sources: ['manual', 'github', 'gitlab'],
  },
];

/**
 * The core steps a source walks through. `securityContext: false` (a space
 * that scores no findings, `ProductSpace.findingSettings`) ends on the basics.
 */
export function coreStepsFor(
  source: CreateProjectSource,
  { securityContext = true }: { securityContext?: boolean } = {},
): CoreCreateProjectStep[] {
  return CORE_CREATE_PROJECT_STEPS.filter(
    (step) => step.sources.includes(source) && (securityContext || step.id !== 'securityContext'),
  );
}

/** A space's steps after the creation, in `order` then `id`. */
export function stepsAfterCreation(steps: readonly CreateProjectStep[] | undefined): CreateProjectStep[] {
  return [...(steps ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

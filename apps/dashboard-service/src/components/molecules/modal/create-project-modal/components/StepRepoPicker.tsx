import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, GitBranch, Search } from '@/components/atoms/icon/icons';
import Input from "../../../../atoms/input/Input";
import Loader from "../../../../atoms/loader/Loader";
import Button from "../../../../atoms/button/Button";
import Card from "../../../../atoms/card/Card";
import EmptyState from "@/components/molecules/empty-state/EmptyState";
import Callout from "@/components/molecules/callout/Callout";
import type { Repository } from "@/server/interfaces/IntegrationProvider";
import {
  Button as VdButton,
  EmptyState as VdEmptyState,
  Notice,
  SearchField,
  Spinner,
} from "@/components/molecules/kit/ui";

import { AS_FOCUS_INSET } from '@/components/atoms/appsec/styles';
export type RepoSource = "github" | "gitlab";

interface StepRepoPickerProps {
  source: RepoSource;
  selectedRepo: Repository | null;
  onRepoChange: (repo: Repository | null) => void;
  linked: boolean;
  repositories: Repository[];
  loading: boolean;
  onConnect: () => void;
  error?: string;
  /**
   * Draws the step with the zinc kit: a search
   * field over a hairline list of 36 px rows, the chosen one in ink on a zinc
   * tint. Omitted: today's step.
   */
  zinc?: boolean;
}

const StepRepoPicker: React.FC<StepRepoPickerProps> = ({
  source,
  selectedRepo,
  onRepoChange,
  linked,
  repositories,
  loading,
  onConnect,
  error,
  zinc = false,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const unlinkedRepos = useMemo(
    () => repositories.filter((r) => !r.projectId),
    [repositories],
  );

  const filteredRepos = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return unlinkedRepos;
    return unlinkedRepos.filter((repo) =>
      (repo.nameWithNamespace || repo.fullName || repo.name)
        .toLowerCase()
        .includes(term),
    );
  }, [unlinkedRepos, search]);

  const notConnectedKey =
    source === "github"
      ? "components.modal.createProject.step1.notConnectedGithub"
      : "components.modal.createProject.step1.notConnectedGitlab";
  const connectKey =
    source === "github"
      ? "components.modal.createProject.step1.connectGithub"
      : "components.modal.createProject.step1.connectGitlab";
  const descriptionKey =
    source === "github"
      ? "components.modal.createProject.step1.repoStepDescriptionGithub"
      : "components.modal.createProject.step1.repoStepDescriptionGitlab";

  if (zinc) {
    return (
      <div className="space-y-4">
        <p className="text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">{t(descriptionKey)}</p>

        {loading ? (
          <div className="flex items-center justify-center rounded-lg border border-zinc-200 py-8 dark:border-vd-line">
            <Spinner />
          </div>
        ) : !linked ? (
          <div className="rounded-lg border border-zinc-200 dark:border-vd-line">
            <VdEmptyState
              title={t(notConnectedKey)}
              action={
                <VdButton variant="ink" onClick={onConnect} trailingIcon={<ExternalLink />}>
                  {t(connectKey)}
                </VdButton>
              }
            />
          </div>
        ) : (
          <div className="space-y-2">
            <SearchField
              aria-label={t("components.modal.createProject.step1.searchRepoLabel")}
              placeholder={t("components.modal.createProject.step1.searchRepoPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filteredRepos.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 dark:border-vd-line">
                <VdEmptyState title={t("components.modal.createProject.step1.noReposAvailable")} />
              </div>
            ) : (
              <ul
                role="listbox"
                aria-label={t("components.modal.createProject.step1.repoListLabel")}
                className="max-h-60 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:divide-vd-line dark:border-vd-line"
              >
                {filteredRepos.map((repo) => {
                  const isSelected = selectedRepo?.id === repo.id;
                  const display = repo.nameWithNamespace || repo.fullName || repo.name;
                  return (
                    <li key={repo.id} className="py-px">
                      <VdButton
                        variant="ghost"
                        fullWidth
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => onRepoChange(repo)}
                        className={
                          "h-9 justify-between rounded-md px-2.5 font-normal " +
                          (isSelected
                            ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-100 dark:bg-white/[0.06] dark:text-zinc-50 dark:hover:bg-white/[0.06]"
                            : "text-zinc-700 dark:text-zinc-300")
                        }
                      >
                        <span className="truncate font-mono text-[12px]">{display}</span>
                        {isSelected && (
                          <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
                            {t("components.modal.createProject.step1.selectedTag")}
                          </span>
                        )}
                      </VdButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t(descriptionKey)}</p>

      <Card variant="outlined" padding="sm">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader size="md" variant="secondary" />
          </div>
        ) : !linked ? (
          <EmptyState
            size="sm"
            icon={<GitBranch className="h-1/2 w-1/2" />}
            title={t(notConnectedKey)}
            action={
              <Button
                variant="secondary"
                onClick={onConnect}
                icon={<ExternalLink className="h-4 w-4" />}
              >
                {t(connectKey)}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            <Input
              aria-label={t("components.modal.createProject.step1.searchRepoLabel")}
              placeholder={t(
                "components.modal.createProject.step1.searchRepoPlaceholder",
              )}
              leftIcon={<Search className="h-4 w-4" />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filteredRepos.length === 0 ? (
              <EmptyState
                size="sm"
                title={t("components.modal.createProject.step1.noReposAvailable")}
              />
            ) : (
              <ul
                role="listbox"
                aria-label={t(
                  "components.modal.createProject.step1.repoListLabel",
                )}
                className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-as-line"
              >
                {filteredRepos.map((repo) => {
                  const isSelected = selectedRepo?.id === repo.id;
                  const display =
                    repo.nameWithNamespace || repo.fullName || repo.name;
                  return (
                    <li key={repo.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => onRepoChange(repo)}
                        className={`flex w-full items-center justify-between border-b border-zinc-100 px-3 py-2 max-md:py-3 text-left font-mono text-[13px] transition-colors duration-[120ms] last:border-b-0 dark:border-as-line ${AS_FOCUS_INSET} ${
                          isSelected
                            ? "bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary-light"
                            : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className="truncate">{display}</span>
                        {isSelected && (
                          <span className="ml-2 font-sans text-[11px] font-medium uppercase">
                            {t(
                              "components.modal.createProject.step1.selectedTag",
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Card>

      {error && (
        <Callout tone="error" size="sm">
          {error}
        </Callout>
      )}
    </div>
  );
};

export default StepRepoPicker;

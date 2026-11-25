import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { RootState } from '../../../server/store';
import { useAuth } from '@/edition/auth/useAuth';
import { EDITION } from '@/edition/edition';
import { AUTH_REFUSAL_KEYS, authRefusalOf } from '@/pages/community-auth/authRefusals';
import usePersonalAccessTokens from '../../../server/hooks/usePersonalAccessTokens';
import {
  canRenameTokens,
  createToken,
  revokeToken,
  updatePersonalAccessTokenName,
} from '../../../server/services/patService';
import type { PersonalAccessTokenView } from '../../../server/interfaces/PersonalAccessToken';
import ProfileTemplateWrapper from '../../../components/molecules/wrapper/ProfileWrapper';
import PatTable from './PatTable';
import PatUsageGuide from './PatUsageGuide';
import CreatePatModal from './CreatePatModal';
import DisplayPatModal from './DisplayPatModal';
import DeletePatModal from './DeletePatModal';
import RenamePatModal from './RenamePatModal';
import { FeatureGate } from '@/components/molecules/feature-gate';
import { copyText } from '@/utils/copyText';
import { useDisabledFeatures } from "@/server/hooks/useDisabledFeatures";

/**
 * The Community Edition's refusal of a token call, as its fixed sentence, or
 * `fallback` for anything outside the closed list: never the server's text.
 */
function communityRefusalKey(err: unknown, fallback: string): string {
  const refusal = authRefusalOf(err);
  return refusal === 'GENERIC' ? fallback : AUTH_REFUSAL_KEYS[refusal];
}

const PersonalAccessTokensPage: React.FC = () => {
  const { t } = useTranslation();
  const isCommunity = EDITION === 'community';
  const user = useSelector((state: RootState) => state.user);
  const { loading: authLoading } = useAuth();
  const isPatDisabled = useDisabledFeatures().has('pat');
  const { tokens, usage, loading, error, failed, refresh } = usePersonalAccessTokens(!isPatDisabled);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [showDisplayModal, setShowDisplayModal] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<PersonalAccessTokenView | null>(null);
  const [tokenToRename, setTokenToRename] = useState<PersonalAccessTokenView | null>(null);

  const handleCreate = async (name: string, expiresAt: number, currentPassword?: string) => {
    try {
      const expiry = expiresAt > 0 ? new Date(expiresAt).toISOString() : undefined;
      // Community: the account's password goes with the creation (the server checks it).
      const created = isCommunity ? await createToken(name, expiry, currentPassword) : await createToken(name, expiry);
      setNewTokenValue(created.token);
      setShowCreateModal(false);
      setShowDisplayModal(true);
      toast.success(t('pages.patPage.toast.createSuccess'));
      refresh();
    } catch (err: any) {
      if (isCommunity) {
        toast.error(t(communityRefusalKey(err, 'pages.patPage.toast.createError')));
        return;
      }
      // Backend returns RESOURCE_EXHAUSTED (HTTP 429) when the user has
      // reached the per-user PAT cap (10). Surface a specific message so
      // the user understands why creation failed even if they bypassed
      // the disabled-button UX guardrail (e.g. via direct API call).
      const status = err?.response?.status;
      if (status === 429) {
        toast.error(t('pages.patPage.toast.capReached'));
      } else if (status === 409) {
        // Token names are unique per user (enforced by Logto).
        toast.error(t('pages.patPage.toast.nameTaken'));
      } else {
        toast.error(t('pages.patPage.toast.createError'));
      }
    }
  };

  const handleCopy = (value: string) => {
    void copyText(value).then((ok) => {
      if (!ok) {
        toast.error(t('pages.patPage.toast.copiedError'));
        return;
      }
      toast.success(t('pages.patPage.toast.copiedSuccess'));
      setShowDisplayModal(false);
      setNewTokenValue(null);
    });
  };

  const handleDelete = async () => {
    if (!tokenToDelete) return;
    try {
      await revokeToken(tokenToDelete);
      toast.success(t('pages.patPage.toast.deleteSuccess'));
      setTokenToDelete(null);
      refresh();
    } catch (err) {
      toast.error(
        t(isCommunity ? communityRefusalKey(err, 'pages.patPage.toast.deleteError') : 'pages.patPage.toast.deleteError'),
      );
    }
  };

  const handleRename = async (newName: string) => {
    if (!tokenToRename) return;
    try {
      await updatePersonalAccessTokenName(tokenToRename.name, newName);
      toast.success(t('pages.patPage.toast.renameSuccess'));
      setTokenToRename(null);
      refresh();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      toast.error(
        t(
          status === 409
            ? 'pages.patPage.toast.nameTaken'
            : 'pages.patPage.toast.renameError',
        ),
      );
    }
  };

  return (
    <ProfileTemplateWrapper user={user} selectedTab="pat" loading={authLoading}>
      <FeatureGate feature="pat" preview featureLabel="Personal Access Tokens">
      <div className="space-y-6">
        <PatTable
          tokens={tokens}
          loading={loading}
          error={isCommunity ? (failed ? t('components.patTable.loadError') : null) : error}
          usage={usage}
          showLastUsed={isCommunity}
          onAdd={() => setShowCreateModal(true)}
          onDelete={(token: PersonalAccessTokenView) => setTokenToDelete(token)}
          onRename={
            canRenameTokens ? (token: PersonalAccessTokenView) => setTokenToRename(token) : undefined
          }
        />

        <PatUsageGuide />
      </div>
      </FeatureGate>

      {!isPatDisabled && showCreateModal && (
        <CreatePatModal
          requirePassword={isCommunity}
          onCreate={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {!isPatDisabled && showDisplayModal && newTokenValue && (
        <DisplayPatModal
          tokenValue={newTokenValue}
          onCopy={handleCopy}
          onClose={() => {
            setShowDisplayModal(false);
            setNewTokenValue(null);
          }}
        />
      )}

      {!isPatDisabled && tokenToDelete && (
        <DeletePatModal
          tokenName={tokenToDelete.name}
          onConfirm={handleDelete}
          onCancel={() => setTokenToDelete(null)}
        />
      )}

      {!isPatDisabled && canRenameTokens && tokenToRename && (
        <RenamePatModal
          currentName={tokenToRename.name}
          onRename={handleRename}
          onClose={() => setTokenToRename(null)}
        />
      )}
    </ProfileTemplateWrapper>
  );
};

export default PersonalAccessTokensPage;

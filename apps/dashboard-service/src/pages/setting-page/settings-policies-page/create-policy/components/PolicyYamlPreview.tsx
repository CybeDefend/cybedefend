// ============================================================================
// PolicyYamlPreview - Sticky panel showing YAML preview
// ============================================================================

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';

import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card';
import Button from '@/components/atoms/button/Button';
import { Clipboard, ClipboardCheck, Code, Download } from '@/components/atoms/icon/icons';
import { copyText } from '@/utils/copyText';

interface PolicyYamlPreviewProps {
  yamlContent: string;
}

const PolicyYamlPreview: React.FC<PolicyYamlPreviewProps> = ({ yamlContent }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyText(yamlContent)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'policy.yaml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Card variant="default" padding="none" className="sticky top-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-as-line">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('pages.policies.yamlPreview')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="w-7 px-0" onClick={handleCopy}>
            {copied ? <ClipboardCheck
              className={cn('h-4 w-4', copied && 'text-green-500')} /> : <Clipboard
              className={cn('h-4 w-4', copied && 'text-green-500')} />}
          </Button>
          <Button variant="ghost" size="sm" className="w-7 px-0" onClick={handleDownload}>
            <Download className="h-4 w-4"  />
          </Button>
        </div>
      </div>

      {/* YAML Content */}
      <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
        <pre
          className={cn(
            'p-4 text-xs font-mono leading-relaxed',
            'bg-zinc-900 text-zinc-100',
            'whitespace-pre-wrap break-words'
          )}
        >
          {yamlContent}
        </pre>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-zinc-200 dark:border-as-line bg-zinc-50 dark:bg-white/[0.03]">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('pages.policies.yamlHint')}
        </p>
      </div>
    </Card>
  );
};

export default PolicyYamlPreview;

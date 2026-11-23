import React from 'react';
import { useTranslation } from 'react-i18next';
import { getPackageType, getPackageTypes, getPackageTypeTranslationKey, getPackageTypeBadgeStyle } from '@/utils/function/packageUtils';
import { ScaDetectedLibrary } from '../../../server/interfaces/Vulnerability';
import { BoxOpen, CodeBranch, Link, QuestionCircle } from '@/components/atoms/icon/icons';
// No `cn` here: utils/function/utils loads i18n, which this badge's test mocks without it.
import { AS_CHIP, AS_TOOLTIP } from '@/components/atoms/appsec/styles';

interface PackageTypeBadgeProps {
  library?: ScaDetectedLibrary;
  packageType?: string | string[];
  showIcon?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
  showTooltip?: boolean;
  tooltipPlacement?: 'top' | 'right';
}

const PackageTypeBadge: React.FC<PackageTypeBadgeProps> = ({ 
  library, 
  packageType, 
  showIcon = true, 
  compact = false,
  iconOnly = false,
  showTooltip = true,
  tooltipPlacement = 'top',
}) => {
  const { t } = useTranslation();
  
  // Determine the package types to display
  let typesToDisplay: string[] = [];
  
  if (packageType) {
    if (Array.isArray(packageType)) {
      typesToDisplay = packageType;
    } else {
      typesToDisplay = [packageType];
    }
  } else if (library) {
    // Use the new function that returns all applicable types
    typesToDisplay = getPackageTypes(library);
  }

  // If no types to display, return null
  if (typesToDisplay.length === 0) {
    return null;
  }
  
  const getIcon = (type: string) => {
    switch (type) {
      case "dev":
        return CodeBranch;
      case "transitive":
        return Link;
      case "direct":
        return BoxOpen;
      default:
        return QuestionCircle;
    }
  };

  const renderSingleBadge = (type: string, isLast: boolean) => {
    const translationKey = getPackageTypeTranslationKey(type);
    const badgeStyle = getPackageTypeBadgeStyle(type);
    const label = t(translationKey);
    const tooltipPosition =
      tooltipPlacement === 'right'
        ? 'left-full top-1/2 ml-2 -translate-y-1/2'
        : 'bottom-full left-1/2 mb-2 -translate-x-1/2';

    if (iconOnly) {
      return (
        <span
          key={type}
          className={`group relative inline-flex items-center justify-center rounded-md p-1 text-xs font-medium whitespace-nowrap ${badgeStyle}`}
          title={label}
          aria-label={label}
        >
          {showIcon && React.createElement(getIcon(type), { className: "w-3 h-3" })}
          {!showIcon && <span className="text-xs font-medium">{label}</span>}
          {showTooltip && (
            <span
              className={`absolute ${tooltipPosition} whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 ${AS_TOOLTIP}`}
            >
              {label}
            </span>
          )}
        </span>
      );
    }
    
    if (compact) {
      return (
        <span
          key={type}
          className={`${AS_CHIP} ${badgeStyle}`}
          title={label}
        >
          {showIcon && React.createElement(getIcon(type), { className: "w-3 h-3" })}
          <span className="text-xs font-medium">{label}</span>
        </span>
      );
    }

    return (
      <span
        key={type}
        className={`${AS_CHIP} ${badgeStyle}`}
      >
        {showIcon && React.createElement(getIcon(type), { className: "w-3 h-3" })}
        {label}
      </span>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {typesToDisplay.map((type, index) =>
        renderSingleBadge(type, index === typesToDisplay.length - 1)
      )}
    </div>
  );
};

export default PackageTypeBadge;

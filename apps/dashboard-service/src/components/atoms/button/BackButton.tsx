
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from '@/components/atoms/icon/icons';
import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';

/** A 32 px hairline button, the `white` Button's look, with a 44 px reach on a phone. */
const ROOT = cn(
  'relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700',
  'transition-colors duration-[120ms] hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 disabled:pointer-events-none',
  'dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-200 dark:hover:bg-white/[0.09]',
  AS_FOCUS,
  AS_TOUCH
);
const ARROW = 'h-4 w-4 text-zinc-400 dark:text-zinc-500';
const SPINNER = 'h-4 w-4 shrink-0 animate-spin opacity-80 mr-1.5';

interface BackButtonProps {
  text?: string;
  to?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const BackButton: React.FC<BackButtonProps> = ({
  text,
  to,
  onClick,
  loading = false,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const buttonText = text || t('common.back');
  const isDisabled = loading || disabled;

  if (onClick) {
    return (
      <button
        onClick={onClick}
        disabled={isDisabled}
        className={ROOT}
      >
        {loading ? (
          <span className="flex items-center">
            <svg
              className={SPINNER}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              ></path>
            </svg>
            {t('components.button.loading')}
          </span>
        ) : (
          <>
            <ArrowLeft
              className={ARROW}
             />
            {buttonText}
          </>
        )}
      </button>
    );
  }

  if (to) {
    return (
      <Link
        to={isDisabled ? "#" : to}
        className={cn(ROOT, isDisabled && "opacity-50 pointer-events-none")}
      >
        {loading ? (
          <span className="flex items-center">
            <svg
              className={SPINNER}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              ></path>
            </svg>
            {t('components.button.loading')}
          </span>
        ) : (
          <>
            <ArrowLeft
              className={ARROW}
             />
            {buttonText}
          </>
        )}
      </Link>
    );
  }

  return (
    <button
      onClick={() => !isDisabled && navigate(-1)}
      disabled={isDisabled}
      className={ROOT}
    >
      {loading ? (
        <span className="flex items-center">
          <svg
            className={SPINNER}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            ></path>
          </svg>
          {t('components.button.loading')}
        </span>
      ) : (
        <>
          <ArrowLeft
            className={ARROW}
           />
          {buttonText}
        </>
      )}
    </button>
  );
};

export default BackButton;

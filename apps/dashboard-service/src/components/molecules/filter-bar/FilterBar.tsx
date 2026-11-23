import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, SortAsc, ChevronDown, X, RotateRight } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import SearchBox from '@/components/atoms/search-box/SearchBox';
import Select, { Option } from '@/components/atoms/select/Select';
import { TOUCH_HIT } from '@/components/atoms/zinc/styles';
import { AS_HAIRLINE } from '@/components/atoms/appsec/styles';

export interface FilterConfig {
    id: string;
    label: string;
    options: Option[];
    value: string[];
    onChange: (value: string[]) => void;
    multiple?: boolean;
    minChecked?: number;
}

export interface TextFilterConfig {
    id: string;
    label: string;
    placeholder?: string;
    value: string;
    onChange: (value: string) => void;
}

/**
 * A period of whole local days, either end optional, as `YYYY-MM-DD`. A field
 * filters only on a real day: what a browser reports while a year is typed
 * digit by digit (0002, 0020, 0202) stays in the field and is never sent.
 */
export interface DateRangeFilterConfig {
    id: string;
    /** Names the filter where the active ones are listed (« Period »). */
    label: string;
    fromLabel: string;
    toLabel: string;
    from: string | null;
    to: string | null;
    onChange: (range: { from: string | null; to: string | null }) => void;
}

/** One page of the choices matching a search, and whether a next page has more. */
export interface SearchSelectPage {
    options: Option[];
    hasMore: boolean;
}

/**
 * One value chosen among many that a server-side search finds (a project, a
 * member). Nothing is asked before the list is opened, and a typed search
 * waits for a pause; scrolling to the end of the open list asks the next page.
 * The chosen value is shown by name, never by id.
 */
export interface SearchSelectFilterConfig {
    id: string;
    label: string;
    /** The choice that unsets the filter (« All projects »). */
    allLabel: string;
    value: string | null;
    /** What the chosen value is called; a fixed sentence when unknown, never the id. */
    valueLabel: string | null;
    searchPlaceholder?: string;
    /** A fixed sentence shown when the search fails; the error itself is never shown. */
    errorText?: string;
    /**
     * Whether the open list has a search box (default: yes). Off for a short
     * closed list a caller serves through `load` (a verdict, an agent), where
     * a box would search a handful of words.
     */
    searchable?: boolean;
    /**
     * One page (from 1) of the choices matching a search. Stable across
     * renders, or the search is asked again.
     */
    load: (search: string, page: number) => Promise<SearchSelectPage>;
    onChange: (option: Option | null) => void;
}

export interface SortConfig {
    orderOptions: Option[];
    directionOptions: Option[];
    selectedOrder: string;
    selectedDirection: string;
    onOrderChange: (value: string) => void;
    onDirectionChange: (value: string) => void;
}

/**
 * `card` (default): the bar of the results tables, a band with its own
 * background and a bottom border. `toolbar`: the bar of a zinc-kit page,
 * drawn to the zinc kit — it sits on the page with no card of its own,
 * a 32 px hairline toggle, the count of active filters as a quiet mono figure,
 * a hairline panel, words in zinc and no icon before a label. Same controls,
 * same behaviour, same test ids.
 */
export type FilterBarVariant = 'card' | 'toolbar';

interface FilterBarProps {
    filters: FilterConfig[];
    textFilters?: TextFilterConfig[];
    dateRange?: DateRangeFilterConfig;
    searchFilters?: SearchSelectFilterConfig[];
    /**
     * Clears every filter in one call instead of one call per filter: for a
     * caller that keeps its filters together (in the URL), where each call
     * would start from the same state and undo the one before.
     */
    onClearFilters?: () => void;
    sort?: SortConfig;
    searchPlaceholder?: string;
    onSearchChange?: (query: string) => void;
    /**
     * What the search field shows, for a caller that holds the search itself
     * (in its URL, where a link, Back and « Clear filters » change it): the
     * field takes the value whenever it changes. A caller that passes what
     * was typed back as it is typed leaves the field alone.
     */
    searchValue?: string;
    className?: string;
    variant?: FilterBarVariant;
}

/** The toolbar's own pieces (zinc, hairlines, 32 px controls, no accent). */
const TOOLBAR = {
    label: 'whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400',
    inlineLabel: 'flex items-center text-[13px] text-zinc-500 dark:text-zinc-400 flex-shrink-0',
    divider: 'w-px h-5 bg-zinc-200 dark:bg-white/[0.07] mx-1',
    panelLabel: 'text-xs font-medium text-zinc-500 dark:text-zinc-400',
    status: 'mt-1 text-xs text-zinc-500 dark:text-zinc-400',
    // `TOUCH_HIT`: a 44 px reach on a phone, the 32 px look kept.
    toggle: cn(
        'relative h-8 shrink-0 gap-1.5 rounded-lg px-3 py-0 text-[13px] font-medium',
        TOUCH_HIT,
        'transition-colors duration-[120ms] active:scale-100',
        'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50',
        // A ring for the keyboard only: a click leaves no halo on a hairline button.
        'focus:ring-0 focus:ring-zinc-300 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-zinc-300',
        'dark:border-white/[0.1] dark:bg-transparent dark:text-zinc-200',
        'dark:hover:border-white/[0.16] dark:hover:bg-white/[0.04] dark:focus-visible:ring-white/20'
    ),
    toggleOpen: 'bg-zinc-50 dark:bg-white/[0.04]',
    count: 'font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400',
    chevron: 'h-3 w-3 text-zinc-400 transition-transform duration-200',
    clear: cn(
        TOUCH_HIT,
        'relative h-8 shrink-0 rounded-lg px-2 py-0 text-[13px] font-normal transition-colors duration-[120ms] active:scale-100',
        'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900',
        'focus:ring-0 focus:ring-zinc-300 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-zinc-300',
        'dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100 dark:focus-visible:ring-white/20'
    ),
    // The day fields wear the select skin: hairline, no grey block in dark.
    day: cn(
        'min-w-[9rem] h-8 rounded-lg py-0 text-[13px] dark:[color-scheme:dark]',
        'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300',
        'dark:border-white/[0.1] dark:bg-white/[0.02] dark:text-zinc-100 dark:hover:border-white/[0.18]'
    ),
    panel: 'mt-2 rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-white/[0.07] dark:bg-[#0c0c0e]',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** No activity is older; it also rules out the years a browser reports while one is typed. */
const MIN_YEAR = 1970;

/** True for a `YYYY-MM-DD` day that exists, from 1970 on. */
export const isFilterDay = (value: string): boolean => {
    if (!DAY.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < MIN_YEAR) return false;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

/**
 * One end of a period. It keeps what is typed; only a usable day, or an empty
 * field, reaches the filter, and leaving the field on anything else puts back
 * the filtered day.
 */
const DayField: React.FC<{
    label: string;
    value: string | null;
    onCommit: (day: string | null) => void;
    toolbar: boolean;
}> = ({ label, value, onCommit, toolbar }) => {
    const [draft, setDraft] = useState({ for: value, text: value ?? '' });
    // A day the caller changed to replaces whatever was being typed.
    if (draft.for !== value) setDraft({ for: value, text: value ?? '' });
    const text = draft.for === value ? draft.text : (value ?? '');
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <span className={toolbar ? TOOLBAR.label : 'whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400'}>{label}</span>
            <Input
                type="date"
                size="sm"
                aria-label={label}
                value={text}
                className={toolbar ? TOOLBAR.day : "min-w-[9rem] rounded-lg dark:[color-scheme:dark]"}
                onChange={(event) => {
                    const next = event.target.value;
                    setDraft({ for: value, text: next });
                    if (next === '') {
                        if (value !== null) onCommit(null);
                    } else if (isFilterDay(next) && next !== value) {
                        onCommit(next);
                    }
                }}
                onBlur={() => {
                    if (text !== '' && !isFilterDay(text)) setDraft({ for: value, text: value ?? '' });
                }}
            />
        </span>
    );
};

const DateRangeFields: React.FC<{ range: DateRangeFilterConfig; toolbar: boolean }> = ({ range, toolbar }) => (
    <div role="group" aria-label={range.label} className="flex flex-wrap items-center gap-2">
        <DayField
            label={range.fromLabel}
            value={range.from}
            onCommit={(from) => range.onChange({ from, to: range.to })}
            toolbar={toolbar}
        />
        <DayField
            label={range.toLabel}
            value={range.to}
            onCommit={(to) => range.onChange({ from: range.from, to })}
            toolbar={toolbar}
        />
    </div>
);

/** How long a typed search waits after the last key: one request per pause. */
const SEARCH_DELAY_MS = 300;
/**
 * The option that unsets a searched choice. Not empty: the Select greys an
 * empty value as a placeholder, and « All projects » read as a disabled field
 * beside « Type: All ». A `*` is in no project or member id.
 */
const ALL_VALUE = '*all*';

type SearchResults =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'ok'; options: Option[]; page: number; hasMore: boolean; loadingMore: boolean };

/**
 * The search being answered. A page answer is kept only while it is still the
 * current one; `loadingMore` is read before React re-renders, so a burst of
 * scroll events asks one page.
 */
interface SearchRun {
    search: string;
    loadingMore: boolean;
}

/**
 * A searched choice, on the design system's Select. It asks nothing until the
 * reader opens it (a click on it arms it), then the first matches, then one
 * search per pause; an answer for a search typed past is dropped. Scrolling to
 * the end of the list adds the next page of the same search; a next page that
 * fails keeps what was loaded and asks no more.
 */
const SearchSelect: React.FC<{
    config: SearchSelectFilterConfig;
    width: string;
    compact: boolean;
    toolbar: boolean;
}> = ({ config, width, compact, toolbar }) => {
    const { value, valueLabel, allLabel, load } = config;
    const [armed, setArmed] = useState(false);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<SearchResults>({ status: 'idle' });
    const current = useRef<SearchRun | null>(null);

    useEffect(() => {
        if (!armed) return undefined;
        const run: SearchRun = { search: search.trim(), loadingMore: false };
        current.current = run;
        setResults({ status: 'loading' });
        const timer = setTimeout(
            () => {
                load(run.search, 1).then(
                    ({ options, hasMore }) => {
                        if (current.current === run) {
                            setResults({ status: 'ok', options, page: 1, hasMore, loadingMore: false });
                        }
                    },
                    () => {
                        if (current.current === run) setResults({ status: 'failed' });
                    },
                );
            },
            search ? SEARCH_DELAY_MS : 0,
        );
        return () => {
            if (current.current === run) current.current = null;
            clearTimeout(timer);
        };
    }, [armed, search, load]);

    const loadMore = () => {
        const run = current.current;
        if (!run || run.loadingMore || results.status !== 'ok' || !results.hasMore) return;
        run.loadingMore = true;
        const next = results.page + 1;
        setResults({ ...results, loadingMore: true });
        load(run.search, next).then(
            ({ options, hasMore }) => {
                if (current.current !== run) return;
                run.loadingMore = false;
                setResults((before) => {
                    if (before.status !== 'ok') return before;
                    // A row that moved to the next page between two requests is listed once.
                    const known = new Set(before.options.map((option) => option.value));
                    const added = options.filter((option) => !known.has(option.value));
                    return { ...before, options: [...before.options, ...added], page: next, hasMore, loadingMore: false };
                });
            },
            () => {
                if (current.current !== run) return;
                // `loadingMore` stays set: one failed page stops the asking for this search.
                setResults((before) =>
                    before.status === 'ok' ? { ...before, hasMore: false, loadingMore: false } : before,
                );
            },
        );
    };

    const found = results.status === 'ok' ? results.options : [];
    const chosen =
        value && !found.some((option) => option.value === value)
            ? [{ value, label: valueLabel ?? allLabel }]
            : [];
    const options: Option[] = [{ value: ALL_VALUE, label: allLabel }, ...chosen, ...found];

    return (
        <div className="min-w-0" onClickCapture={() => setArmed(true)}>
            <Select
                skin={toolbar ? 'zinc' : undefined}
                aria-label={config.label}
                options={options}
                placeholder={allLabel}
                value={value ?? ALL_VALUE}
                onChange={(next: string) => {
                    if (next === ALL_VALUE) config.onChange(null);
                    else config.onChange(options.find((option) => option.value === next) ?? null);
                }}
                searchable={config.searchable !== false}
                searchPlaceholder={config.searchPlaceholder}
                onSearchChange={setSearch}
                searching={results.status === 'loading'}
                onLoadMore={loadMore}
                hasMore={results.status === 'ok' && results.hasMore}
                loadingMore={results.status === 'ok' && results.loadingMore}
                width={width}
                compact={compact}
            />
            {results.status === 'failed' && config.errorText && (
                <p role="status" className={toolbar ? TOOLBAR.status : 'mt-1 text-xs text-zinc-500 dark:text-zinc-400'}>
                    {config.errorText}
                </p>
            )}
        </div>
    );
};

/**
 * FilterBar - A responsive filter bar component for vulnerability tables
 * - Desktop large: All filters displayed inline
 * - Desktop medium/overflow: Collapsible filter panel
 * - Mobile: Always collapsible filter section
 */
const FilterBar: React.FC<FilterBarProps> = ({
    filters,
    textFilters,
    dateRange,
    searchFilters,
    onClearFilters,
    sort,
    searchPlaceholder,
    onSearchChange,
    searchValue,
    className,
    variant = 'card',
}) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const toolbar = variant === 'toolbar';

    // A list that may be left empty (`minChecked: 0`) filters nothing when it
    // is: empty is its « all ».
    const emptyMeansAll = (filter: FilterConfig) => filter.minChecked === 0;
    // A filter counts as active when it is not showing everything it could.
    const isActive = (filter: FilterConfig) =>
        filter.value.length !== filter.options.length &&
        !(emptyMeansAll(filter) && filter.value.length === 0);
    const activeFilters = filters.filter(isActive);
    // A period with either end set, a searched choice with a value.
    const activeExtras = [
        ...(dateRange && (dateRange.from || dateRange.to) ? [dateRange.label] : []),
        ...(searchFilters ?? []).filter((filter) => filter.value).map((filter) => filter.label),
    ];
    const activeFilterCount = activeFilters.length + activeExtras.length;

    // A bare "1" on the Filters button never said *what* was filtered, and an
    // empty result list gave no way back — so a hidden default read as "you
    // have no vulnerabilities".
    const activeFilterNames = [...activeFilters.map((filter) => filter.label), ...activeExtras].join(', ');
    const clearFilters = () => {
        if (onClearFilters) {
            onClearFilters();
            return;
        }
        for (const filter of filters) {
            if (isActive(filter)) {
                filter.onChange(emptyMeansAll(filter) ? [] : filter.options.map((option) => option.value));
            }
        }
        for (const textFilter of textFilters ?? []) {
            if (textFilter.value) textFilter.onChange('');
        }
        if (dateRange && (dateRange.from || dateRange.to)) dateRange.onChange({ from: null, to: null });
        for (const searchFilter of searchFilters ?? []) {
            if (searchFilter.value) searchFilter.onChange(null);
        }
    };

    // Force collapsed mode if more than 4 filters + sort (likely to overflow)
    const totalControls =
        filters.length + (searchFilters?.length ?? 0) + (dateRange ? 2 : 0) + (sort ? 2 : 0);
    const shouldCollapse = totalControls > 5;

    return (
        <div
            className={cn(
                toolbar ? 'min-w-0' : 'px-4 py-2.5 border-b border-zinc-200 bg-white dark:border-as-line dark:bg-as-surface',
                className
            )}
        >
            {/* Desktop Layout - Inline when enough space */}
            <div
                data-filter-bar-inline={toolbar ? '' : undefined}
                className={cn(
                    'hidden',
                    !shouldCollapse && 'xl:flex xl:items-center xl:gap-2'
                )}
            >
                {/* Filters Section */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <div className={toolbar ? TOOLBAR.inlineLabel : 'flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400 flex-shrink-0'}>
                        {!toolbar && <Filter className="w-4 h-4 text-zinc-400" />}
                        <span className="whitespace-nowrap">{t('components.resultsTable.filterBy')}</span>
                    </div>

                    {filters.map((filter) => (
                        <Select
                            skin={toolbar ? 'zinc' : undefined}
                            key={filter.id}
                            options={filter.options}
                            placeholder={filter.label}
                            value={filter.value}
                            onChange={filter.onChange}
                            multiple={true as const}
                            minChecked={filter.minChecked ?? 1}
                            width="w-auto"
                            displayPrefix={filter.label}
                            compact
                        />
                    ))}

                    {searchFilters?.map((sf) => (
                        <SearchSelect key={sf.id} config={sf} width="w-48" compact toolbar={toolbar} />
                    ))}

                    {dateRange && <DateRangeFields range={dateRange} toolbar={toolbar} />}

                    {textFilters?.map((tf) => (
                        <div key={tf.id} className="w-40">
                            <Input
                                size="sm"
                                value={tf.value}
                                onChange={(e) => tf.onChange(e.target.value)}
                                placeholder={tf.placeholder ?? tf.label}
                                aria-label={tf.label}
                            />
                        </div>
                    ))}


                    {activeFilterCount > 0 && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={clearFilters}
                            title={t('components.filterBar.activeOn', { names: activeFilterNames })}
                            icon={toolbar ? undefined : <RotateRight className="w-3.5 h-3.5" />}
                            className={toolbar ? TOOLBAR.clear : undefined}
                        >
                            {t('components.filterBar.clearFilters')}
                        </Button>
                    )}
                    {sort && (
                        <>
                            <div className={toolbar ? TOOLBAR.divider : `w-px h-5 mx-1 ${AS_HAIRLINE}`} />
                            <div className={toolbar ? TOOLBAR.inlineLabel : 'flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400 flex-shrink-0'}>
                                {!toolbar && <SortAsc className="w-4 h-4 text-zinc-400" />}
                                <span className="whitespace-nowrap">{t('components.resultsTable.orderBy')}</span>
                            </div>
                            <Select
                                skin={toolbar ? 'zinc' : undefined}
                                options={sort.orderOptions}
                                placeholder={t('components.resultsTable.order')}
                                value={sort.selectedOrder}
                                onChange={sort.onOrderChange}
                                width="w-auto"
                                compact
                            />
                            <Select
                                skin={toolbar ? 'zinc' : undefined}
                                options={sort.directionOptions}
                                placeholder={t('components.resultsTable.direction')}
                                value={sort.selectedDirection}
                                onChange={sort.onDirectionChange}
                                width="w-auto"
                                compact
                            />
                        </>
                    )}
                </div>

                {/* Spacer */}
                <div className="flex-1 min-w-4" />

                {/* Search */}
                {onSearchChange && (
                    <div className="flex-shrink-0 w-56">
                        <SearchBox
                            initialValue={searchValue}
                            placeholder={searchPlaceholder || t('components.resultsTable.searchPlaceholder')}
                            onSearch={onSearchChange}
                        />
                    </div>
                )}
            </div>

            {/* Collapsed/Mobile Layout */}
            <div className={cn(
                shouldCollapse ? 'block' : 'xl:hidden'
            )}>
                {/* Top row: Search + Toggle button */}
                <div className={toolbar ? 'flex flex-wrap items-center gap-2' : 'flex items-center gap-2'}>
                    {onSearchChange && (
                        <div className="flex-1 min-w-0">
                            <SearchBox
                                initialValue={searchValue}
                                placeholder={searchPlaceholder || t('components.resultsTable.searchPlaceholder')}
                                onSearch={onSearchChange}
                            />
                        </div>
                    )}

                    {/* Named by its own text, hidden visually below `sm` only:
                        an `aria-label` would drop the count of active filters
                        from the name a screen reader announces. */}
                    <Button
                        variant={toolbar ? 'outline' : 'white'}
                        onClick={() => setIsExpanded(!isExpanded)}
                        aria-expanded={isExpanded}
                        className={toolbar ? cn(TOOLBAR.toggle, isExpanded && TOOLBAR.toggleOpen) : cn(
                            // `shrink-0`: the search box beside it gives way, not the toggle.
                            'flex shrink-0 gap-1.5 px-3 rounded-lg border-zinc-200 dark:border-as-line-strong',
                            isExpanded && 'bg-zinc-50 dark:bg-white/[0.06]'
                        )}
                    >
                        {/* The toolbar names itself by its word at every width, so it needs no funnel. */}
                        {!toolbar && <Filter className="w-4 h-4 text-zinc-400" />}
                        <span className={toolbar ? undefined : 'sr-only sm:not-sr-only'}>{t('components.filterBar.filters')}</span>
                        {/* A space in the name (« Filters 3 »); the flex gap lays them out. */}
                        {activeFilterCount > 0 && ' '}
                        {activeFilterCount > 0 && (
                            <span
                                data-testid="filter-bar-active-count"
                                title={t('components.filterBar.activeOn', { names: activeFilterNames })}
                                className={toolbar ? TOOLBAR.count : 'font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-200'}
                            >
                                {activeFilterCount}
                            </span>
                        )}
                        <ChevronDown className={cn(
                            toolbar ? TOOLBAR.chevron : 'w-4 h-4 text-zinc-400 transition-transform',
                            isExpanded && 'rotate-180'
                        )} />
                    </Button>

                    {/* The way out of what is hiding results, without opening the panel.
                        Its icon alone on a phone: the label crushed the search box to its icon. */}
                    {activeFilterCount > 0 && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className={toolbar ? TOOLBAR.clear : 'shrink-0'}
                            onClick={clearFilters}
                            aria-label={t('components.filterBar.clearFilters')}
                            title={t('components.filterBar.activeOn', { names: activeFilterNames })}
                            icon={toolbar ? undefined : <RotateRight className="w-3.5 h-3.5" />}
                        >
                            {/* On its own row, the toolbar's word has the room a results table's lacks. */}
                            <span className={toolbar ? undefined : 'hidden sm:inline'}>{t('components.filterBar.clearFilters')}</span>
                        </Button>
                    )}
                </div>

                {/* Expandable filter section */}
                {isExpanded && (
                    <div
                        data-testid="filter-bar-panel"
                        className={toolbar ? TOOLBAR.panel : 'mt-3 pt-3 border-t border-zinc-200 dark:border-as-line'}
                    >
                        <div className="space-y-3">
                            {/* Filters */}
                            <div className="space-y-2">
                                <p className={toolbar ? TOOLBAR.panelLabel : 'text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5'}>
                                    {!toolbar && <Filter className="w-3.5 h-3.5 text-zinc-400" />}
                                    {t('components.resultsTable.filterBy')}
                                </p>
                                {/* One column on a phone: two cut the lists' labels at 320 px (« Agent … »). */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                    {filters.map((filter) => (
                                        <Select
                                            skin={toolbar ? 'zinc' : undefined}
                                            key={filter.id}
                                            options={filter.options}
                                            placeholder={filter.label}
                                            value={filter.value}
                                            onChange={filter.onChange}
                                            multiple={true as const}
                                            minChecked={filter.minChecked ?? 1}
                                            width="w-full"
                                            displayPrefix={filter.label}
                                        />
                                    ))}
                                    {searchFilters?.map((sf) => (
                                        <SearchSelect key={sf.id} config={sf} width="w-full" compact={false} toolbar={toolbar} />
                                    ))}
                                    {textFilters?.map((tf) => (
                                        <Input
                                            key={tf.id}
                                            value={tf.value}
                                            onChange={(e) => tf.onChange(e.target.value)}
                                            placeholder={tf.placeholder ?? tf.label}
                                            aria-label={tf.label}
                                        />
                                    ))}
                                </div>
                                {dateRange && <DateRangeFields range={dateRange} toolbar={toolbar} />}
                            </div>

                            {/* Sort */}
                            {sort && (
                                <div className="space-y-2">
                                    <p className={toolbar ? TOOLBAR.panelLabel : 'text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5'}>
                                        {!toolbar && <SortAsc className="w-3.5 h-3.5 text-zinc-400" />}
                                        {t('components.resultsTable.orderBy')}
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Select
                                            skin={toolbar ? 'zinc' : undefined}
                                            options={sort.orderOptions}
                                            placeholder={t('components.resultsTable.order')}
                                            value={sort.selectedOrder}
                                            onChange={sort.onOrderChange}
                                            width="w-full"
                                        />
                                        <Select
                                            skin={toolbar ? 'zinc' : undefined}
                                            options={sort.directionOptions}
                                            placeholder={t('components.resultsTable.direction')}
                                            value={sort.selectedDirection}
                                            onChange={sort.onDirectionChange}
                                            width="w-full"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FilterBar;

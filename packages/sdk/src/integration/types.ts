/**
 * Integration module types — standardized UI integration points
 * for the Antigravity Agent View.
 *
 * @module integration/types
 */

// ─── Integration Points ──────────────────────────────────────────────────

/**
 * Standardized integration points in the Agent View UI.
 *
 * Each point corresponds to a specific DOM location in the
 * Antigravity chat interface (verified 2026-02-28).
 */
export enum IntegrationPoint {
    /** Top bar — next to +, refresh, ... icons */
    TOP_BAR = 'topBar',
    /** Top right corner — before the X (close) button */
    TOP_RIGHT = 'topRight',
    /** Input area — next to voice/send buttons */
    INPUT_AREA = 'inputArea',
    /** Bottom icon row — file, terminal, artifact, chrome icons */
    BOTTOM_ICONS = 'bottomIcons',
    /** Per-turn metadata — appended inside each conversation turn */
    TURN_METADATA = 'turnMeta',
    /** User message badge — small badge inside user message bubbles */
    USER_BADGE = 'userBadge',
    /** Bot response action — button next to Good/Bad feedback */
    BOT_ACTION = 'botAction',
    /** 3-dot dropdown menu — extra items in the overflow menu */
    DROPDOWN_MENU = 'dropdownMenu',
    /** Chat title bar — interaction on conversation title */
    CHAT_TITLE = 'chatTitle',
}

// ─── Configuration Interfaces ──────────────────────────────────────────

/**
 * Base configuration for all integration points.
 */
export interface IIntegrationBase {
    /** Unique ID for this integration (prevents duplicates) */
    id: string;
    /** Which integration point to target */
    point: IntegrationPoint;
    /** Whether this integration is enabled (default: true) */
    enabled?: boolean;
}

/**
 * Configuration for button-type integrations (top bar, input area, etc.).
 */
export interface IButtonIntegration extends IIntegrationBase {
    point:
    | IntegrationPoint.TOP_BAR
    | IntegrationPoint.TOP_RIGHT
    | IntegrationPoint.INPUT_AREA
    | IntegrationPoint.BOTTOM_ICONS;
    /** Icon (emoji or text glyph) */
    icon: string;
    /** Tooltip text */
    tooltip?: string;
    /** Toast to show on click */
    toast?: IToastConfig;
    /** CSS class override */
    className?: string;
}

/**
 * Configuration for turn-level metadata integration.
 */
export interface ITurnMetaIntegration extends IIntegrationBase {
    point: IntegrationPoint.TURN_METADATA;
    /** Which metrics to display */
    metrics: TurnMetric[];
    /** Whether turns are clickable to show details toast */
    clickable?: boolean;
}

/**
 * Configuration for user message badges.
 */
export interface IUserBadgeIntegration extends IIntegrationBase {
    point: IntegrationPoint.USER_BADGE;
    /** What to show in the badge */
    display: 'charCount' | 'wordCount' | 'custom';
    /** Custom formatter function body (receives `textLength` as arg) */
    customFormat?: string;
}

/**
 * Configuration for bot response action buttons.
 */
export interface IBotActionIntegration extends IIntegrationBase {
    point: IntegrationPoint.BOT_ACTION;
    /** Icon */
    icon: string;
    /** Label text */
    label: string;
    /** Toast config on click */
    toast?: IToastConfig;
}

/**
 * Configuration for dropdown menu items.
 */
export interface IDropdownIntegration extends IIntegrationBase {
    point: IntegrationPoint.DROPDOWN_MENU;
    /** Menu item icon */
    icon?: string;
    /** Menu item label */
    label: string;
    /** Add separator before this item */
    separator?: boolean;
    /** Toast config on click */
    toast?: IToastConfig;
}

/**
 * Configuration for chat title interaction.
 */
export interface ITitleIntegration extends IIntegrationBase {
    point: IntegrationPoint.CHAT_TITLE;
    /** Interaction type */
    interaction: 'click' | 'dblclick' | 'hover';
    /** Hint text shown on hover */
    hint?: string;
    /** Toast config on interaction */
    toast?: IToastConfig;
}

/**
 * Toast popup configuration.
 */
export interface IToastConfig {
    /** Toast title */
    title: string;
    /** Badge label and colors */
    badge?: {
        text: string;
        bgColor: string;
        textColor: string;
    };
    /** Key-value rows to display */
    rows: IToastRow[];
    /** Auto-dismiss after N milliseconds (default: 6000) */
    duration?: number;
}

/**
 * A row in a toast popup.
 */
export interface IToastRow {
    /** Label (left side) */
    key: string;
    /**
     * Value (right side).
     * Can be a static string or a dynamic expression.
     * Dynamic expressions are JS code that runs in the renderer,
     * with access to `getStats()` which returns conversation stats.
     */
    value: string;
    /** If true, `value` is treated as a JS expression */
    dynamic?: boolean;
}

/**
 * Metrics available for turn metadata display.
 */
export type TurnMetric =
    | 'turnNumber'
    | 'userCharCount'
    | 'aiCharCount'
    | 'codeBlocks'
    | 'thinkingIndicator'
    | 'ratio'
    | 'separator';

/**
 * Union type of all integration configurations.
 */
export type IntegrationConfig =
    | IButtonIntegration
    | ITurnMetaIntegration
    | IUserBadgeIntegration
    | IBotActionIntegration
    | IDropdownIntegration
    | ITitleIntegration;

// ─── Manager Interface ────────────────────────────────────────────────

/**
 * Public interface for the Integration Manager.
 */
export interface IIntegrationManager {
    /** Register a single integration point */
    register(config: IntegrationConfig): void;
    /** Register multiple integration points at once */
    registerMany(configs: IntegrationConfig[]): void;
    /** Remove a registered integration by ID */
    unregister(id: string): void;
    /** Get all registered integrations */
    getRegistered(): ReadonlyArray<IntegrationConfig>;
    /** Generate the integration script from all registered configs */
    build(): string;
    /** Install the generated script into workbench.html. Returns true if content changed. */
    install(): Promise<boolean>;
    /** Remove the integration from workbench.html */
    uninstall(): Promise<void>;
    /** Check if an integration is currently installed */
    isInstalled(): boolean;
}

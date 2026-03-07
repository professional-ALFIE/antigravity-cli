/**
 * Title Manager — Extension-host API for managing chat titles.
 *
 * Allows extensions to programmatically rename conversations
 * by writing to a data file that the renderer-side title proxy reads.
 *
 * Also provides a direct localStorage synchronization mechanism
 * via the integration script's window.__agSDKTitles API.
 *
 * @module integration/title-manager
 *
 * @example
 * ```typescript
 * const sdk = new AntigravitySDK(context);
 * await sdk.initialize();
 *
 * // Rename via extension host (writes data file, renderer picks up on next poll)
 * sdk.titles.rename('cascade-uuid', 'My Custom Title');
 *
 * // Get all custom titles
 * const titles = sdk.titles.getAll();
 *
 * // Remove a custom title (reverts to auto-generated summary)
 * sdk.titles.remove('cascade-uuid');
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../core/logger';
import { IDisposable } from '../core/disposable';
import { getTitlesDataFile } from './title-proxy';

const log = new Logger('TitleManager');

/**
 * Manages custom conversation titles from the extension host.
 *
 * Titles are persisted in a JSON file in the workbench directory.
 * The renderer-side title proxy reads this file and merges with localStorage.
 */
export class TitleManager implements IDisposable {
    private _titles: Record<string, string> = {};
    private _dataPath: string = '';
    private _initialized = false;

    /**
     * Initialize with the workbench directory path.
     *
     * @param workbenchDir - Path to workbench directory where data file is stored
     * @param namespace - Extension namespace for file isolation
     */
    initialize(workbenchDir: string, namespace: string = 'default'): void {
        this._dataPath = path.join(workbenchDir, getTitlesDataFile(namespace));
        this._load();
        this._initialized = true;
        log.info(`Initialized, ${Object.keys(this._titles).length} custom titles loaded`);
    }

    /**
     * Check if the manager is initialized.
     */
    get isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * Set a custom title for a conversation.
     *
     * The title will be displayed in the Agent View title bar
     * and conversation list instead of the auto-generated summary.
     *
     * @param cascadeId - The conversation's cascade ID (UUID)
     * @param title - The custom title to display
     *
     * @example
     * ```typescript
     * // Rename the active conversation
     * const id = sdk.titles.getActiveCascadeId();
     * sdk.titles.rename(id, 'Project Alpha Discussion');
     * ```
     */
    rename(cascadeId: string, title: string): void {
        if (!cascadeId) {
            log.warn('rename: cascadeId is required');
            return;
        }
        if (!title || !title.trim()) {
            log.warn('rename: title cannot be empty');
            return;
        }
        this._titles[cascadeId] = title.trim();
        this._save();
        log.debug(`Renamed ${cascadeId.substring(0, 8)}... -> "${title.trim()}"`);
    }

    /**
     * Get the custom title for a conversation.
     *
     * @param cascadeId - The conversation's cascade ID
     * @returns The custom title, or undefined if no custom title is set
     */
    getTitle(cascadeId: string): string | undefined {
        return this._titles[cascadeId];
    }

    /**
     * Get all custom titles.
     *
     * @returns A copy of the titles map (cascadeId -> title)
     */
    getAll(): Readonly<Record<string, string>> {
        return { ...this._titles };
    }

    /**
     * Remove a custom title, reverting to the auto-generated summary.
     *
     * @param cascadeId - The conversation's cascade ID
     */
    remove(cascadeId: string): void {
        if (this._titles[cascadeId]) {
            delete this._titles[cascadeId];
            this._save();
            log.debug(`Removed title for ${cascadeId.substring(0, 8)}...`);
        }
    }

    /**
     * Remove all custom titles.
     */
    clear(): void {
        this._titles = {};
        this._save();
        log.debug('Cleared all custom titles');
    }

    /**
     * Get the number of custom titles.
     */
    get count(): number {
        return Object.keys(this._titles).length;
    }

    /** Load titles from the data file */
    private _load(): void {
        try {
            if (fs.existsSync(this._dataPath)) {
                const content = fs.readFileSync(this._dataPath, 'utf8');
                this._titles = JSON.parse(content) || {};
            }
        } catch (err) {
            log.warn(`Failed to load titles: ${err}`);
            this._titles = {};
        }
    }

    /** Save titles to the data file */
    private _save(): void {
        if (!this._dataPath) return;
        try {
            fs.writeFileSync(this._dataPath, JSON.stringify(this._titles, null, 2), 'utf8');
        } catch (err) {
            log.warn(`Failed to save titles: ${err}`);
        }
    }

    dispose(): void {
        // Nothing to clean up - titles persist on disk
    }
}

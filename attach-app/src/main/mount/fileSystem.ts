// This file provides functions to interact with the filesystem, such as reading directory contents and managing mounted shares.

import { promises as fs, Stats } from 'fs';
import path from 'path';

export async function readDirectoryContents(dirPath: string): Promise<string[]> {
    try {
        const files = await fs.readdir(dirPath);
        return files;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        throw error;
    }
}

export async function getFileStats(filePath: string): Promise<Stats> {
    try {
        const stats = await fs.stat(filePath);
        return stats;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error(`Error getting stats for file ${filePath}:`, error);
        }
        throw error;
    }
}

export function isDirectory(stats: Stats): boolean {
    return stats.isDirectory();
}

export function getFullPath(basePath: string, relativePath: string): string {
    return path.join(basePath, relativePath);
}
/**
 * crypto.js — 加密、密钥派生、完整性校验
 *
 * WebCrypto：PBKDF2-SHA256 600000 次迭代派生 256 位 AES-GCM 密钥。
 * 双重完整性校验：AES-GCM 认证标签 + 明文 checksum 比对。
 * 无 DOM 依赖，纯函数模块。
 */

import { CONFIG } from './config.js';

export const Crypto = {
    /**
     * 从主密码 + 盐派生 AES-GCM 密钥。
     * @param {string} password
     * @param {Uint8Array} salt
     * @returns {Promise<CryptoKey>}
     */
    async deriveKey(password, salt) {
        const textEncoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: salt, iterations: CONFIG.PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    /**
     * 计算字符串的 SHA-256 校验和。
     * @param {string} text
     * @returns {Promise<string>}
     */
    async computeStringChecksum(text) {
        const textEncoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
        return Array.from(new Uint8Array(hashBuffer))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
    },

    /**
     * 加密任意可 JSON 序列化的数据。
     * @param {CryptoKey} key
     * @param {*} data
     * @returns {Promise<{iv: number[], ciphertext: number[], checksum: string}>}
     */
    async encrypt(key, data) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plaintext = JSON.stringify(data);
        const checksum = await this.computeStringChecksum(plaintext);
        const textEncoder = new TextEncoder();
        const ciphertextBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv, additionalData: textEncoder.encode(checksum) },
            key,
            textEncoder.encode(plaintext)
        );
        return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertextBuffer)),
            checksum: checksum
        };
    },

    /**
     * 解密。
     * @param {CryptoKey} key
     * @param {{iv: number[], ciphertext: number[], checksum: string}} encryptedObject
     * @returns {Promise<*>}
     */
    async decrypt(key, encryptedObject) {
        const iv = new Uint8Array(encryptedObject.iv);
        const ciphertext = new Uint8Array(encryptedObject.ciphertext);
        const checksum = encryptedObject.checksum;

        if (!checksum) throw new Error('缺少完整性校验值');

        const textEncoder = new TextEncoder();
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv, additionalData: textEncoder.encode(checksum) },
            key,
            ciphertext
        );
        const plaintext = new TextDecoder().decode(decryptedBuffer);

        const computedChecksum = await this.computeStringChecksum(plaintext);
        if (computedChecksum !== checksum) {
            throw new Error('数据完整性校验失败，可能已损坏或被篡改');
        }

        return JSON.parse(plaintext);
    },

    /**
     * 创建认证验证器。
     * @param {CryptoKey} key
     * @returns {Promise<object>}
     */
    async createAuthVerifier(key) {
        return this.encrypt(key, { test: 'serene-vault-verified-v3' });
    },

    /**
     * 验证主密码是否正确。
     * @param {CryptoKey} key
     * @param {object} authData
     * @returns {Promise<boolean>}
     */
    async verifyAuth(key, authData) {
        try {
            await this.decrypt(key, authData);
            return true;
        } catch (error) {
            return false;
        }
    }
};
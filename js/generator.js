/**
 * generator.js — 密码生成器
 *
 * 使用拒绝采样避免模偏差。Fisher-Yates 洗牌打乱字符顺序。
 */

import { CONFIG } from './config.js';

/**
 * 生成 [0, maxExclusive) 范围内的均匀随机整数。
 * @param {number} maxExclusive
 * @returns {number}
 */
export function secureRandomInt(maxExclusive) {
    if (maxExclusive <= 0) return 0;
    if (maxExclusive === 1) return 0;
    if (maxExclusive > 256) {
        throw new Error('secureRandomInt 不支持 maxExclusive > 256，请使用扩展实现');
    }
    const maxValid = 256 - (256 % maxExclusive);
    const buffer = new Uint8Array(1);
    while (true) {
        crypto.getRandomValues(buffer);
        if (buffer[0] < maxValid) {
            return buffer[0] % maxExclusive;
        }
    }
}

/**
 * 批量生成均匀随机整数。
 * @param {number} count
 * @param {number} maxExclusive
 * @returns {number[]}
 */
export function secureRandomIntBatch(count, maxExclusive) {
    if (count <= 0) return [];
    const results = new Array(count);
    for (let index = 0; index < count; index++) {
        results[index] = secureRandomInt(maxExclusive);
    }
    return results;
}

/**
 * 生成强密码。
 * 保证至少含 1 个小写、1 个大写、1 个数字、1 个符号。
 * @param {number} [length]
 * @returns {string}
 */
export function generateSecurePassword(length) {
    let targetLength = length || CONFIG.GENERATED_PASSWORD_LENGTH;
    if (targetLength < CONFIG.LOGIN_PW_MIN) targetLength = CONFIG.LOGIN_PW_MIN;
    if (targetLength > CONFIG.LOGIN_PW_MAX) targetLength = CONFIG.LOGIN_PW_MAX;

    const lowerCaseCharacters = 'abcdefghijklmnopqrstuvwxyz';
    const upperCaseCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numberCharacters = '0123456789';
    const symbolCharacters = '!@#$%^&*()-_=+[]{};:,.<>?';
    const allCharacters = lowerCaseCharacters + upperCaseCharacters + numberCharacters + symbolCharacters;

    const passwordCharacters = [
        lowerCaseCharacters[secureRandomInt(lowerCaseCharacters.length)],
        upperCaseCharacters[secureRandomInt(upperCaseCharacters.length)],
        numberCharacters[secureRandomInt(numberCharacters.length)],
        symbolCharacters[secureRandomInt(symbolCharacters.length)]
    ];

    for (let index = 4; index < targetLength; index++) {
        passwordCharacters.push(allCharacters[secureRandomInt(allCharacters.length)]);
    }

    // Fisher-Yates 洗牌
    for (let index = passwordCharacters.length - 1; index > 0; index--) {
        const randomIndex = secureRandomInt(index + 1);
        const temporaryCharacter = passwordCharacters[index];
        passwordCharacters[index] = passwordCharacters[randomIndex];
        passwordCharacters[randomIndex] = temporaryCharacter;
    }

    return passwordCharacters.join('');
}

/**
 * 生成 6 位数字交易密码。
 * @returns {string}
 */
export function generateTransactionPassword() {
    const digits = secureRandomIntBatch(CONFIG.TRAN_PW_LEN, 10);
    return digits.join('');
}
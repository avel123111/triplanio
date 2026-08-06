/**
 * TRIP-274 Ф1.4 — правило «ссылка не понижает выданное приглашение».
 *
 * Запуск: deno test supabase/functions/redeemTripInviteLink/redeemRole_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { resolveRedeemRole } from './redeemRole.ts';

Deno.test('свежий редим: строки нет → роль берётся из ссылки', () => {
  assertEquals(resolveRedeemRole(null, 'viewer'), 'viewer');
  assertEquals(resolveRedeemRole(null, 'admin'), 'admin');
});

// ★ Тот самый случай из ТЗ: viewer-ссылка НЕ понижает admin-приглашение.
Deno.test('★ viewer-ссылка не понижает выданное admin-приглашение', () => {
  assertEquals(resolveRedeemRole('admin', 'viewer'), 'admin');
});

Deno.test('admin-ссылка ПОВЫШАЕТ выданное viewer-приглашение', () => {
  assertEquals(resolveRedeemRole('viewer', 'admin'), 'admin');
});

Deno.test('совпадающие роли ничего не меняют', () => {
  assertEquals(resolveRedeemRole('viewer', 'viewer'), 'viewer');
  assertEquals(resolveRedeemRole('admin', 'admin'), 'admin');
});

// Белый список, а не «не viewer»: строка с незнакомой ролью не должна оказаться
// сильнее ссылки — иначе мусорное значение в trip_members давало бы повышение.
Deno.test('незнакомая роль в строке не переживает редим', () => {
  for (const junk of ['', 'Admin', 'ADMIN', 'owner', 'editor', 'guest']) {
    assertEquals(resolveRedeemRole(junk, 'viewer'), 'viewer', `роль ${junk}`);
  }
});

/**
 * Контракт АННОТАЦИЙ ПРОПОВ у компонентов дизайн-системы (TRIP-388).
 *
 * ★ ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ. Аннотация пропа заявляет ДВА поведения:
 *   1) обязательное остаётся обязательным, неверное значение краснеет;
 *   2) ЗАКОННЫЙ ПРОП ЦЕЛИ ПРОХОДИТ.
 * Первый заход проверил только первое - мутацией «снять аннотацию → краснеет».
 * Этого мало по построению: «слишком строгая аннотация» живёт ровно во втором,
 * непроверенном направлении, и дефект нашёлся именно там (ревью Codex).
 * Тот же закон, что у гардов: зелёный прогон ничего не значит, пока не увидел
 * его красным, и мутировать надо КАЖДОЕ заявленное поведение, а не удобное.
 *
 * ★★ ГЛАВНОЕ ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ПИНИТСЯ: БАЗА АННОТАЦИИ = ТО, КУДА
 * КОМПОНЕНТ РЕАЛЬНО ОТДАЁТ `...rest`. Ошибка повторилась ЧЕТЫРЕ раза подряд,
 * потому что правило копировалось ФОРМОЙ, а не смыслом:
 *   `@param {object}`                  → запечатал набор ПРОПОВ;
 *   пересечение с `<'div'>` у примитива → запечатало НОСИТЕЛЬ;
 *   пересечение с `<'div'>` у `DialogContent` → запечатало ЦЕЛЬ ПРОБРОСА
 *     (остаток уезжает в `DialogPrimitive.Content`, а у `div` нет
 *      `onEscapeKeyDown`/`onPointerDownOutside`);
 *   `DialogTitle` не пересекался ВООБЩЕ - закрытый объект из трёх ключей.
 * Компонент, который остаток НЕ пробрасывает (весь `design/index.jsx`), закрыт
 * законно: лишний проп там - молчаливый no-op, и краснота на нём правильная.
 *
 * ⚠️ ПРОБА ЖИВЁТ ВНЕ `src/`: файл `.jsx` с элементами ДС, забытый внутри,
 * попадёт в периметр `audit-design.mjs` и поднимет `dsshare` - главное число
 * эпика - не написав ни одного экрана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** Строки пробы: `clean` обязана пройти, `error` обязана покраснеть.
 *  У КАЖДОГО аннотированного компонента есть и то, и другое - иначе файл
 *  доказывает половину и ровно в той половине прячется дефект. */
const LINES = [
  // ── проброс остатка: база взята у ЦЕЛИ, а не у `div` ──────────────────────
  ['clean', '<DialogContent onEscapeKeyDown={() => {}} onPointerDownOutside={() => {}} className="x">c</DialogContent>'],
  ['clean', '<DialogTitle id="x" asChild><h2>t</h2></DialogTitle>'],
  ['clean', '<Input onFocus={() => {}} maxLength={5} icon="search" />'],
  ['clean', '<Textarea rows={3} placeholder="p" />'],
  ['clean', '<InputGroup role="group"><span>x</span></InputGroup>'],
  // Остаток `IconBtn` уезжает на `<button>`, значит носитель и есть база. Строка
  // проверяет ВТОРОЕ направление аннотации: мутация «снять аннотацию» краснеет и
  // при СЛИШКОМ СТРОГОМ типе, поэтому «обязательное обязательно» ничего про
  // строгость не доказывает - дефект живёт ровно здесь (урок TRIP-388).
  // Пропы ниже не декоративны: их вешает Radix через `asChild` на триггер
  // колокольчика и меню строки, и без них меню не открывается.
  ['clean', '<IconBtn icon="more" ariaLabel="x" data-state="open" onPointerDown={() => {}} type="button" />'],
  // ── компоненты БЕЗ проброса: законный проп проходит ───────────────────────
  ['clean', '<Icon name="file" size={20} />'],
  ['clean', '<Btn variant="ghost" onClick={() => {}}>b</Btn>'],
  // Три оси IconBtn независимы, и это ровно то, ради чего они три: `.lp-back` -
  // это soft И round одновременно, плоский юнион такую пару не выразил бы.
  ['clean', '<IconBtn icon="close" ariaLabel="x" tone="soft" round />'],
  ['clean', '<IconBtn icon="plus" ariaLabel="x" size="sm" tone="danger" onClick={() => {}} />'],
  ['clean', '<Avatar name="A" size="sm" />'],
  ['clean', '<Field label="L"><span>x</span></Field>'],
  ['clean', '<FileRow name="a.pdf" />'],
  ['clean', '<Severity level="info">s</Severity>'],
  ['clean', '<EmptyState title="t" />'],
  ['clean', '<Badge variant="ok">b</Badge>'],
  ['clean', '<Card title="t">x</Card>'],
  ['clean', '<Checkbox checked onChange={() => {}} />'],
  ['clean', '<Toggle on onChange={() => {}} />'],
  ['clean', '<Toggle on locked busy label="l" />'],
  ['clean', '<AvatarStack people={[]} />'],
  ['clean', '<PartnerLogo url="u" />'],
  ['clean', '<StreamEventRow e={{}} />'],
  // `r` принимает и число, и токен: живой вызов пишет `var(--r-xl)`, а вывод
  // из дефолта `r = 6` знал только number.
  ['clean', '<Skeleton w={10} h={4} r={"var(--r-xl)"} />'],
  // `t()` берёт подстановку вторым аргументом; тип шёл с ЗАГЛУШКИ контекста,
  // а не с реализации, и объявлял функцию одного аргумента.
  ['clean', '<span>{tt("a.b", { n: 1 })}</span>'],
  // ── обязательное осталось обязательным / неверное значение краснеет ───────
  ['error', '<Icon size={20} />'],
  ['error', '<FileRow href="/x" />'],
  ['error', '<StreamEventRow onClick={() => {}} />'],
  ['error', '<Icon name={5} />'],
  ['error', '<Skeleton w={{}} />'],
  ['error', '<Checkbox checked="yes" />'],
  // Набор обличий закрыт ТИПОМ, а не гардом: несуществующий тон - ошибка в
  // редакторе, а не красный CI (ТЗ 07). И подпись обязательна: кнопка без
  // текста без `aria-label` для скринридера безымянна.
  ['error', '<IconBtn icon="close" ariaLabel="x" tone="compact" />'],
  ['error', '<IconBtn icon="close" />'],
  // ⚠️ ДАТЧИК СЛЕПОТЫ САМОЙ ПРОБЫ: `href` не бывает у `div`. Один раз конфиг
  // пробы уже был слепым (React-типы вырождались в `any`) и печатал вывод байт
  // в байт тот же при ВОЗВРАЩЁННОМ дефекте. Эта строка обязана краснеть.
  ['error', '<Row as="div" href="/x">s</Row>'],
];

const HEAD = [
  '// @ts-check',
  "import { Avatar, AvatarStack, Badge, Btn, Card, Checkbox, EmptyState, Field, FileRow, IconBtn, PartnerLogo, Severity, Skeleton, StreamEventRow, Toggle, DialogContent, DialogTitle, Row } from '@/design/index';",
  "import { Input, Textarea, InputGroup } from '@/design/Input';",
  "import { Icon } from '@/design/icons';",
  "import { useI18n } from '@/lib/i18n/I18nContext';",
  'export const P = () => {',
  '  const { t: tt } = useI18n();',
  '  return (',
];
const OPEN = '  <>';
const CLOSE = '  );';

test('★★ АННОТАЦИИ ПРОПОВ ДС: законное проходит, неверное краснеет', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-props-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      // `extends` НАСТОЯЩЕГО конфига - проба судит тем же, чем гейт, и
      // разойтись с ним не может. Отдельно замаплен `react/jsx-runtime`: без
      // него tsc печатает TS2875 на ПЕРВОМ JSX-теге пробы, и эта чужая ошибка
      // садится на чью-то строку. Маппинг ведёт в @types, а НЕ в untyped JS -
      // именно последнее делало пробу слепой в прошлый раз.
      extends: join(REPO, 'jsconfig.json'),
      compilerOptions: {
        noEmit: true, checkJs: true, baseUrl: dir,
        paths: {
          '@/*': [join(REPO, 'src', '*')],
          'react/jsx-runtime': [join(REPO, 'node_modules', '@types', 'react', 'jsx-runtime')],
        },
      },
      include: ['probe.jsx'],
    }));

    const body = LINES.map((pair) => '    ' + pair[1]);
    writeFileSync(join(dir, 'probe.jsx'), [...HEAD, OPEN, ...body, '  </>', CLOSE, '};'].join('\n'));

    const r = spawnSync('npx', ['tsc', '-p', join(dir, 'tsconfig.json')], { cwd: REPO, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const bad = new Set([...out.matchAll(/probe\.jsx\((\d+),/g)].map((m) => Number(m[1])));

    LINES.forEach(([kind, jsx], i) => {
      const line = HEAD.length + 1 + i + 1; // +1 за строку OPEN
      if (kind === 'clean') {
        assert.equal(bad.has(line), false, `должно быть ЧИСТО, а tsc ругается: ${jsx}\n${out}`);
      } else {
        assert.equal(bad.has(line), true, `аннотация НЕ ловит: ${jsx}\n${out}`);
      }
    });

    // «Ошибок нет вовсе» = все clean прошли И все error провалились молча.
    // Пусть скажет прямо, а не сойдёт за успех.
    assert.ok(bad.size > 0, `tsc не выдал НИ ОДНОЙ ошибки — прогон не состоялся:\n${out}`);
    assert.equal(bad.size, LINES.filter((l) => l[0] === 'error').length, `лишние ошибки вне ожидаемых строк:\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

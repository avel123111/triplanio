---
name: triplanio-overlay-pro-unification
description: Аудит всех всплывающих элементов + Pro-слоя и план унификации под Lumo; компаньон дизайн-системы
metadata: 
  node_type: memory
  type: project
  originSessionId: 15e6e784-ea85-47ad-9d0a-dbcd008cb4b8
---

★Аудит 2026-06-07 (triplanio_new@dev): всё, что всплывает (модалки/панели/поповеры/меню/тосты/нативные alert) + сквозной Pro-слой. Отчёт `OVERLAY_PRO_AUDIT_2026-06-07.md` (Часть A оверлеи, B Pro, **C — актуальные директивы+план**).

Находки: 5 параллельных движков оверлеев; 7 способов «карточки поверх»; 4 «сырые» `.dlg--sm` на position:fixed без Radix (ProLocked/TripProInfo/PaymentSuccess/Fail) — **Esc НЕ работает**, focus-trap нет (Radix-оверлеи Esc закрывают). `ui/dropdown-menu` — мёртвый код, меню собраны вручную (Members `openMenu`, Account `acct-lang`). Обратная связь на 3 канала: 15 нативных `alert()` + тосты(2 варианта) + инлайн-флеш. Инлайн-ошибки в 4 видах: ValidationUI / setErr-строкой(Budget) / acct-sev(Account) / error-box(Pro.jsx).

Сверка экранов: Account уже без alert() → плашка `.acct-sev` (=копия `.sev--error`); язык `.acct-lang` листбокс. Budget-диалоги на дизайн-`Dialog` через `window.__openModal`, ошибки сырым setErr.

РЕШЕНИЯ Pavel: (1) **полный ремап Pro `--warm`(оранж,68 ссылок)→`--pro`/`--pro-gradient` (ЗОЛОТО)** с тотальной токенизацией — смена минимума токенов перекрашивает все Pro-элементы. (2) **bottom-sheet** не было в Lumo → спроектирован; ниже 640px C1 Modal/C2 Confirm/C3 SidePanel рендерятся как `.sheet` через одну обёртку `<Overlay>`. (3) инлайн warning/error строго по дизайну: `.field--error/--warning` + `.err/.wrn`, блочные → `.sev--*`, всплыв → `.toast`(4 типа info/success/warning/error). (4) Pro-элементы привести к Lumo: `.badge--pro`,`.btn--pro`,`.pro-up`,`.locktag`,`.modal`+`.mi--pro`, `PaymentResultDialog(status)`, `.sub-card`. crown=апселл, lock=недоступно; гейт-линзы не скрывать а показывать с locktag+CTA.

Канон: C1 Modal/C2 Confirm/C3 SidePanel/C4 Popover/C5 Menu/C6 BottomSheet + F1 Toast. Pro: P1 бейдж/locktag, P2 btn--pro, P3 pro-up, P4 ProUpsellModal(ProLocked+TripProInfo слить), P5 PaymentResultDialog(success+fail слить), P6 sub-card.

Компаньон дизайн-системы (наследует токены Lumo, тема/палитра, новый bottom-sheet): **`Triplanio design new/DESIGN_SYSTEM_LUMO_OVERLAYS_PRO_2026-06-07.html`**. В осн. Lumo-файле надо добавить ссылку.

План Ф0(меню/ActionMenu+saveMsg)→Ф1(тосты+выпил alert)→Ф2(инлайн-валидация)→Ф3(Pro-визуал/ремап)→Ф4(ProUpsellModal)→**Ф5 оплата PaymentResultDialog — отдельно+тест Stripe prod/dev**→Ф6(Overlay-обёртка+bottom-sheet+депрекейт window.__openModal)→Ф7(ProGate). Логику гейтинга/Stripe НЕ трогать. ОТКРЫТО: Pro-бейдж на обложке трипа (медиа-вариант или единый badge--pro?).

Связано: [[triplanio-lumo-gap]] [[triplanio-pro-model]] [[triplanio-pro-audit]] [[triplanio-style-token-audit]] [[triplanio-pro-status-hook]] [[triplanio-cancel-downgrade-no-tripsubrow-bug]]

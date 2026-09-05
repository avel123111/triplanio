import React from 'react';
import { Col } from '@/design/index';
import BudgetSummaryCard from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard from '@/components/trips/MembersSummaryCard';
import ServicesCard from '@/components/trips/ServicesCard';
import PreparationCard, { PreparationSkeleton } from '@/components/trips/PreparationCard';
import TripFrame, { TripFrameSkeleton } from '@/components/trips/TripFrame';
import { useTripAccess } from '@/components/trips/TripAccessContext';

// Скелетон Обзора — ТОТ ЖЕ ДЕРЕВО, что у живого экрана: те же обёртки, те же
// виджеты, каждый рисует свою фазу загрузки сам (`isLoading`). Своей геометрии
// здесь нет намеренно: любое расхождение — прыжок содержимого ровно в тот
// момент, когда на него смотрят, а обёртки решают отступы не меньше, чем сами
// блоки (кадр и полоса плиток лежат ВНУТРИ `.ov-anim`, а не отдельными детьми
// колонки — вынеси их наружу, и зазоры станут другими).
export function OverviewSkeleton() {
  return (
    <Col gap="g8" className="ovwrap" aria-busy="true">
      <div className="ov-anim"><TripFrameSkeleton /></div>
      <div className="ov-grid">
        <div className="ov-anim"><PreparationSkeleton /></div>
        <Col gap="g8" className="ov-anim">
          <BudgetSummaryCard isLoading budget={{}} />
          <MembersSummaryCard isLoading members={[]} />
          <ServicesCard isLoading services={[]} />
        </Col>
      </div>
    </Col>
  );
}

// ЭКРАН ПОЕЗДКИ — кадр сверху, под ним две колонки, по порядку вопросов:
//   1. КАДР ПОЕЗДКИ — что это и где: КАРТА во всю ширину, состояние во времени —
//      панелью поверх неё, числа маршрута полосой плиток под кадром. Карта здесь
//      главная и видна сразу: превью на 280 px уезжало под сгиб, стоило добавить
//      на экран что-нибудь ещё.
//   2. ПОДГОТОВКА — что осталось сделать: ночлеги и переезды, каждая строка
//      кликается (забронированное — в просмотр, пустое — в добавление брони).
//      Работа занимает ЛЕВУЮ, широкую колонку.
//   3. РАЗДЕЛЫ — деньги, люди, сервисы: стопка в правой колонке. Полосой во всю
//      ширину они уходили под сгиб — три виджета из пяти пришлось бы искать
//      прокруткой.
export default function OverviewLens({
  trip,
  visits = [],
  transfers = [],
  hotels = [],
  budget,
  budgetExpenses = [],
  budgetCategories = [],
  members = [],
  memberProfiles = {},
  services = [],
  user,
  isLoading = false,
  contentLoading = false,
  active = true,
  budgetEnabled = false,
  onOpenMap,
  onOpenBudget,
  onOpenMembers,
  onAddService,
  onOpenService,
  onBudgetLocked,
  onAddHotel,
  onAddTransfer,
}) {
  // Право управления (editor) — из единого контекста доступа (TRIP-274 Ф2.2),
  // раздаётся подкартам (бюджет/участники) как булев проп.
  const { canEdit: canManage } = useTripAccess();

  if (isLoading) return <OverviewSkeleton />;

  return (
    <Col gap="g8" className="ovwrap">
      <div className="ov-anim">
        <TripFrame
          trip={trip}
          visits={visits}
          transfers={transfers}
          active={active}
          isLoading={contentLoading}
          onOpenMap={onOpenMap}
        />
      </div>

      <div className="ov-grid">
        <div className="ov-anim">
        <PreparationCard
          visits={visits}
          hotels={hotels}
          transfers={transfers}
          isLoading={contentLoading}
          onAddHotel={onAddHotel}
          onAddTransfer={onAddTransfer}
          onOpenRoute={onOpenMap}
        />
        </div>

        <Col gap="g8" className="ov-anim">
        <BudgetSummaryCard
          trip={trip}
          budget={budget}
          budgetExpenses={budgetExpenses}
          budgetCategories={budgetCategories}
          canManage={canManage}
          budgetEnabled={budgetEnabled}
          isLoading={contentLoading}
          onOpen={onOpenBudget}
          onLocked={onBudgetLocked}
        />
        <MembersSummaryCard
          trip={trip}
          members={members}
          profiles={memberProfiles}
          user={user}
          canManage={canManage}
          isLoading={contentLoading}
          onOpenMembers={onOpenMembers}
        />
        <ServicesCard services={services} isLoading={contentLoading} onAddService={onAddService} onOpenService={onOpenService} />
        </Col>
      </div>
    </Col>
  );
}

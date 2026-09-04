import React from 'react';
import BudgetSummaryCard from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard from '@/components/trips/MembersSummaryCard';
import ServicesCard from '@/components/trips/ServicesCard';
import PreparationCard, { PreparationSkeleton } from '@/components/trips/PreparationCard';
import TripFrame, { TripFrameSkeleton } from '@/components/trips/TripFrame';
import { useTripAccess } from '@/components/trips/TripAccessContext';
import { Skeleton } from '@/design/index';

// Скелетон Обзора — та же геометрия, что у живого экрана: три полосы (кадр
// поездки → подготовка → разделы в ряд). Один источник для обеих фаз загрузки.
export function OverviewSkeleton() {
  const sec = (rows) => (
    <section className="ovsec">
      <div className="ovsec__h"><Skeleton w={150} h={20} r={6} /></div>
      {rows.map((h, i) => <Skeleton key={i} w="100%" h={h} r="var(--r-sm)" />)}
    </section>
  );
  return (
    <div className="ovwrap" aria-busy="true">
      <TripFrameSkeleton />
      <div className="ov-grid">
        <PreparationSkeleton />
        <div className="ov-side">
          {sec([26, 11, 14])}
          {sec([34, 34, 42])}
          {sec([44, 44])}
        </div>
      </div>
    </div>
  );
}

// ЭКРАН ПОЕЗДКИ — три полосы во всю ширину, по порядку вопросов:
//   1. КАДР ПОЕЗДКИ — что это и где: КАРТА во всю ширину полосы, состояние во
//      времени и готовность — одной панелью поверх неё, числа маршрута тихой
//      подписью под кадром. Карта здесь главная и видна сразу: до пересборки она
//      была превью на 280 px и уезжала под сгиб, стоило добавить на экран
//      что-нибудь ещё.
//   2. ПОДГОТОВКА — что осталось сделать: ночлеги и переезды, каждая строка
//      кликается (забронированное — в просмотр, пустое — в добавление брони).
//   3. РАЗДЕЛЫ — деньги, люди, сервисы: СТОПКА в правой колонке, рядом с
//      подготовкой. Полосой во всю ширину они уходили под сгиб — на ноутбуке три
//      виджета из пяти приходилось искать прокруткой.
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
  onOpenEvent,
}) {
  // Право управления (editor) — из единого контекста доступа (TRIP-274 Ф2.2),
  // раздаётся подкартам (бюджет/участники) как булев проп.
  const { canEdit: canManage } = useTripAccess();

  if (isLoading) return <OverviewSkeleton />;

  return (
    <div className="ovwrap">
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
          onOpenEvent={onOpenEvent}
          onOpenRoute={onOpenMap}
        />
        </div>

        <div className="ov-anim ov-side">
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
        <ServicesCard services={services} onAddService={onAddService} onOpenService={onOpenService} />
        </div>
      </div>
    </div>
  );
}

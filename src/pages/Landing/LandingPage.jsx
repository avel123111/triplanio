import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

/* =========================================================
   Landing page — ported from triplanio_landing static site.
   Dynamically loads/unloads /landing.css to avoid style
   conflicts with the main app.
========================================================= */

const APP_URL = '/login';

/* ── i18n ── */
const TRANSLATIONS = {
  EN: {
    "nav.features": "Features",
    "nav.how": "How it works",
    "nav.faq": "FAQ",
    "header.cta": "Start Planning",
    "lang.label": "Language",
    "hero.h1_a": "Your whole trip.",
    "hero.h1_b_accent": "One",
    "hero.h1_c": "beautiful plan.",
    "hero.lede": "Build multi-city itineraries, plan together, track budgets in every currency, and let Triplanio handle the boring parts.",
    "hero.cta_primary": "Start Planning",
    "hero.cta_secondary": "See how it works",
    "hero.trust_free": "Free to start",
    "hero.trust_no_card": "No credit card",
    "hero.trust_languages": "Multilingual platform",
    "mockup.trips": "Trips",
    "mockup.this_trip": "This trip",
    "mockup.trip_title": "Iberia — Summer '26",
    "mockup.subtitle": "Jul 12 → Jul 23 · 3 cities · 4 travelers",
    "mockup.tab_timeline": "Timeline",
    "mockup.tab_calendar": "Calendar",
    "mockup.tab_map": "Map",
    "mockup.nights_4": "Lisbon · 4 nights",
    "mockup.nights_2": "Porto · 2 nights",
    "mockup.nights_5": "Barcelona · 5 nights",
    "mockup.other_trip_1": "Japan in cherry season",
    "mockup.other_trip_2": "Patagonia trek",
    "mockup.tag_flight": "Flight",
    "mockup.tag_hotel": "Hotel",
    "mockup.tag_activity": "Activity",
    "mockup.tag_transfer": "Transfer",
    "mockup.checkin": "check-in",
    "mockup.day1": "Sat · Jul 12",
    "mockup.day2": "Sun · Jul 13",
    "mockup.day3": "Wed · Jul 16",
    "float.trip_budget": "Trip budget",
    "float.leave_at_title": "Leave at 14:10",
    "float.leave_at_sub": "Train to Porto, 30 min from hotel",
    "city.lisbon": "Lisbon",
    "city.porto": "Porto",
    "city.barcelona": "Barcelona",
    "problem.eyebrow": "Before Triplanio",
    "problem.h2_a": "Your trip lives in 12 tabs",
    "problem.h2_b": "and a Notes app.",
    "problem.lede": "Hotel confirmations in your inbox. Flights in screenshots. The itinerary in a Google Doc nobody else opened. Budgets on a napkin.",
    "problem.handoff": "Triplanio brings it together.",
    "problem.inbox": "Inbox · 3 of 12",
    "problem.mail1_from": "Booking.com",
    "problem.mail1_subj": "Memmo Alfama — Your reservation is confirmed (LIS)",
    "problem.mail2_from": "British Airways",
    "problem.mail2_subj": "E-ticket BA503 LHR → LIS · Sat 12 Jul · Seat 14A",
    "problem.mail3_from": "Comboios de Portugal",
    "problem.mail3_subj": "Alfa Pendular · Lisboa-Sta. Apolónia → Porto-Campanhã",
    "problem.notes_title": "iberia plan v3 (real)",
    "problem.notes_body_html": "· lisbon: book tram 28 ??<br/>· ask mike if he wants porto wine cellars<br/>· barcelona airbnb — pin link???<br/>· €€€ check w/ sam",
    "problem.tab1": "Tripadvisor — Lisbon",
    "problem.tab2": "Google Doc · Itinerary",
    "problem.tab3": "Booking · Porto",
    "problem.tab4": "Maps",
    "problem.tabs_body": "12 tabs open · 4 windows · which one had the rental?",
    "features.eyebrow": "Features",
    "features.h2": "Everything your trip needs, in one place.",
    "features.lede": "Five things Triplanio does that change how you plan.",
    "f.timeline.title": "All-in-one timeline",
    "f.timeline.body": "Cities, transfers, hotels, activities — sorted by date and timezone, automatically.",
    "f.together.title": "Plan together",
    "f.together.body": "Invite friends and family — even people without an account — and edit the trip as a team with clear roles.",
    "f.ai.title": "AI trip planner",
    "f.ai.body": "Describe the trip you want and get a complete draft itinerary in seconds, ready to refine.",
    "f.concierge.title": "AI travel concierge in Telegram & WhatsApp",
    "f.concierge.body": "Smart reminders for check-ins, cancellation deadlines and departures — plus an AI assistant that answers questions about your plan, right in chat.",
    "f.budget.title": "Multi-currency budget",
    "f.budget.body": "Spend in any currency. Triplanio auto-aggregates every booking with real FX rates and clean categories.",
    "mini.hotels": "Hotels",
    "mini.flights": "Flights",
    "mini.activities": "Activities",
    "mini.food": "Food",
    "mini.transfers": "Transfers",
    "mini.food_misc": "Food & misc",
    "mini.under": "€180 under",
    "mini.under_plan": "€180 under plan",
    "mini.total": "Trip total",
    "mini.home_ccy": "Home currency · EUR · live FX",
    "how.eyebrow": "How it works",
    "how.h2": "From idea to itinerary in three steps.",
    "how.s1.title": "Create your trip",
    "how.s1.body": "Add destinations, dates and who's coming. Triplanio generates a skeleton you can fill in at your own pace.",
    "how.s2.title": "Add the details — or let AI do it",
    "how.s2.body": "Hotels, flights, transfers, activities. Use the AI trip planner to draft a full itinerary from a single prompt.",
    "how.s3.title": "Travel together, stress less",
    "how.s3.body": "Share with co-travelers, get smart reminders, track budgets, and keep every booking in one place.",
    "thumb.new_trip": "New trip",
    "thumb.where": "Where",
    "thumb.from": "From",
    "thumb.to": "To",
    "thumb.organizer": "You · organizer",
    "thumb.travelers": "+ 3 travelers",
    "thumb.from_date": "Jul 12",
    "thumb.to_date": "Jul 23",
    "thumb.ai_planner": "AI planner",
    "thumb.ai_prompt": "“11 days, 4 people, slow pace, ocean swims, no museums.”",
    "thumb.ai_result_1": "Lisbon · 4 nights · Alfama base",
    "thumb.ai_result_2": "Porto · 2 nights · river views",
    "thumb.ai_result_3": "Barcelona · 5 nights · beach side",
    "thumb.day_of_travel": "Day of travel",
    "thumb.cancel_msg": "Free-cancellation for Memmo Alfama ends in 2 days.",
    "thumb.confirm": "Confirm it",
    "thumb.confirmed": "Confirmed · synced to your timeline",
    "dd.eyebrow": "A closer look",
    "dd.h2": "The product, in detail.",
    "dd.threeviews.eyebrow": "Timeline · Calendar · Map",
    "dd.threeviews.title": "One trip, three views.",
    "dd.threeviews.body": "See your trip the way you think about it. Switch between a chronological timeline, a calendar view that shows free days at a glance, and a map that draws every leg of your route across the world.",
    "dd.threeviews.h1": "Click any city to expand its stay",
    "dd.threeviews.h2": "Drag-and-drop to reorder activities",
    "dd.threeviews.h3": "Map auto-fits as your trip grows",
    "dd.planner.eyebrow": "AI trip planner",
    "dd.planner.title": "An AI that actually plans the trip.",
    "dd.planner.body": "Tell Triplanio where you want to go, how long you have and what you love doing. It returns a draft itinerary — cities, transfers, suggested stays, must-see spots — in seconds. Tweak anything, keep what works.",
    "dd.planner.h1": "Multi-city routes",
    "dd.planner.h2": "Realistic pacing",
    "dd.planner.h3": "Editable like any handmade plan",
    "dd.concierge.eyebrow": "Telegram & WhatsApp",
    "dd.concierge.title": "A travel concierge in your pocket.",
    "dd.concierge.body": "Connect your trip to Telegram or WhatsApp and get smart, timezone-aware nudges — when to leave for the airport, when free-cancellation expires, what's next on the day's plan. Ask the AI assistant anything about your trip and get a clear answer in chat.",
    "dd.concierge.h1": "Smart timezone-aware reminders",
    "dd.concierge.h2": "“What’s my hotel address?” answered instantly",
    "dd.concierge.h3": "Mute per trip",
    "dd.budget.eyebrow": "Smart budget",
    "dd.budget.title": "Real budgets, in any currency.",
    "dd.budget.body": "Triplanio auto-pulls every hotel, transfer and activity price into a single budget — in your home currency — using live exchange rates. Add custom categories, override rates for cash purchases, and see exactly where the money goes.",
    "dd.budget.h1": "Auto-aggregated from bookings",
    "dd.budget.h2": "Live FX or manual rates",
    "dd.budget.h3": "Custom categories",
    "planner.user_msg": "11 days · 4 people · Iberia · slow pace · ocean swims · no museums.",
    "planner.ai_msg": "Drafting a route from Lisbon north along the coast to Barcelona…",
    "planner.res_lisbon": "Lisbon · 4 nights",
    "planner.res_lisbon_sub": "Alfama, ocean light, slow mornings",
    "planner.res_train": "Lisbon → Porto",
    "planner.res_train_sub": "Alfa Pendular · 2h 50m · 08:39",
    "planner.res_porto": "Porto · 2 nights",
    "planner.res_porto_sub": "Douro views, no museum agenda",
    "planner.res_flight": "Porto → Barcelona",
    "planner.res_flight_sub": "Vueling 6602 · 2h 20m",
    "planner.badge_stay": "Stay",
    "planner.badge_transfer": "Transfer",
    "planner.badge_flight": "Flight",
    "phone.via": "via Telegram · online",
    "phone.today": "Today · 09:14",
    "phone.b1": "Heads up — the train to Porto leaves in 4h 25m. Leave the hotel by 14:10 to be safe.",
    "phone.u1": "What's the platform?",
    "phone.b2": "Sta. Apolónia · Platform 3. Your seats are coach 22, 41A–D.",
    "phone.u2": "Hotel address in Porto?",
    "phone.b3": "Torel Avantgarde — R. da Restauração 336, 4050-501 Porto. Check-in from 14:00.",
    "trust.languages": "Multilingual platform",
    "trust.devices": "Works on any device — no app to install",
    "trust.privacy": "Private by default — your trip is yours",
    "trust.free": "Free to start, forever",
    "faq.eyebrow": "FAQ",
    "faq.h2": "Frequently asked.",
    "faq.lede": "Short answers to the things people always want to know first. Anything else — write to us inside the app.",
    "faq.q1": "Is Triplanio free?",
    "faq.a1": "Yes. You can plan a trip end-to-end without paying. Some advanced features — like the AI trip planner and AI voucher parsing — are part of an optional Pro plan.",
    "faq.q2": "Can I invite people who don't have an account?",
    "faq.a2": "Yes. Add them as offline participants while you plan; when you're ready, send them an invite and they can join in one click.",
    "faq.q3": "Is Triplanio multilingual?",
    "faq.a3": "Yes. Triplanio is multilingual — switch languages any time from the header.",
    "faq.q4": "How does the AI work?",
    "faq.a4": "It generates draft itineraries from your description and helps fill in booking details from your vouchers. Everything is editable — AI is a starting point, not a black box.",
    "faq.q5": "Can I track shared expenses?",
    "faq.a5": "Yes. The budget engine supports multi-currency expenses, custom categories and split-by-shares between trip members.",
    "faq.q6": "Will my data stay private?",
    "faq.a6": "Yes. Your trips are visible only to you and the people you invite. Public share links exist only when you generate one.",
    "faq.q7": "Do I need to install an app?",
    "faq.a7": "No. Triplanio runs in any modern browser, on phone, tablet and desktop.",
    "finalcta.h2": "Your next trip deserves better than 12 browser tabs.",
    "finalcta.lede": "Start planning in under a minute. Free, no card required.",
    "finalcta.cta": "Start Planning",
    "footer.tagline": "Plan, share, travel.",
    "footer.product": "Product",
    "footer.features": "Features",
    "footer.how": "How it works",
    "footer.faq": "FAQ",
    "footer.company": "Company",
    "footer.about": "About",
    "footer.contact": "Contact",
    "footer.legal": "Legal",
    "footer.privacy": "Privacy",
    "footer.terms": "Terms",
    "footer.copy": "© 2026 Triplanio",
  },
  RU: {
    "nav.features": "Возможности",
    "nav.how": "Как это работает",
    "nav.faq": "Вопросы",
    "header.cta": "Начать планировать",
    "lang.label": "Язык",
    "hero.h1_a": "Вся ваша поездка.",
    "hero.h1_b_accent": "Один",
    "hero.h1_c": "красивый план.",
    "hero.lede": "Стройте маршруты по нескольким городам, планируйте вместе, ведите бюджет в любой валюте — Triplanio возьмёт рутину на себя.",
    "hero.cta_primary": "Начать планировать",
    "hero.cta_secondary": "Как это работает",
    "hero.trust_free": "Бесплатный старт",
    "hero.trust_no_card": "Без банковской карты",
    "hero.trust_languages": "Мультиязычная платформа",
    "mockup.trips": "Поездки",
    "mockup.this_trip": "Эта поездка",
    "mockup.trip_title": "Иберия — лето '26",
    "mockup.subtitle": "12 июля → 23 июля · 3 города · 4 путешественника",
    "mockup.tab_timeline": "Таймлайн",
    "mockup.tab_calendar": "Календарь",
    "mockup.tab_map": "Карта",
    "mockup.nights_4": "Лиссабон · 4 ночи",
    "mockup.nights_2": "Порту · 2 ночи",
    "mockup.nights_5": "Барселона · 5 ночей",
    "mockup.other_trip_1": "Япония в сезон сакуры",
    "mockup.other_trip_2": "Трек по Патагонии",
    "mockup.tag_flight": "Перелёт",
    "mockup.tag_hotel": "Отель",
    "mockup.tag_activity": "Активность",
    "mockup.tag_transfer": "Трансфер",
    "mockup.checkin": "заезд",
    "mockup.day1": "Сб · 12 июля",
    "mockup.day2": "Вс · 13 июля",
    "mockup.day3": "Ср · 16 июля",
    "float.trip_budget": "Бюджет поездки",
    "float.leave_at_title": "Выходите в 14:10",
    "float.leave_at_sub": "Поезд в Порту, 30 мин от отеля",
    "city.lisbon": "Лиссабон",
    "city.porto": "Порту",
    "city.barcelona": "Барселона",
    "problem.eyebrow": "До Triplanio",
    "problem.h2_a": "Поездка живёт в 12 вкладках",
    "problem.h2_b": "и в заметках на телефоне.",
    "problem.lede": "Брони отелей — в почте. Билеты — в скриншотах. Маршрут — в Google Doc, который никто кроме вас не открыл. Бюджет — на салфетке.",
    "problem.handoff": "Triplanio собирает всё вместе.",
    "problem.inbox": "Входящие · 3 из 12",
    "problem.mail1_from": "Booking.com",
    "problem.mail1_subj": "Memmo Alfama — бронирование подтверждено (LIS)",
    "problem.mail2_from": "British Airways",
    "problem.mail2_subj": "Электронный билет BA503 LHR → LIS · Сб 12 июля · Место 14A",
    "problem.mail3_from": "Comboios de Portugal",
    "problem.mail3_subj": "Alfa Pendular · Лиссабон → Порту",
    "problem.notes_title": "план иберия v3 (точно)",
    "problem.notes_body_html": "· лиссабон: забронить трам 28 ??<br/>· спросить майка про винные погреба порту<br/>· барселона airbnb — пин ссылка???<br/>· €€€ уточнить у сэма",
    "problem.tab1": "Tripadvisor — Лиссабон",
    "problem.tab2": "Google Doc · Маршрут",
    "problem.tab3": "Booking · Порту",
    "problem.tab4": "Карты",
    "problem.tabs_body": "12 вкладок · 4 окна · в какой была аренда?",
    "features.eyebrow": "Возможности",
    "features.h2": "Всё для поездки — в одном месте.",
    "features.lede": "Пять возможностей Triplanio, которые меняют то, как вы планируете.",
    "f.timeline.title": "Единая таймлайн",
    "f.timeline.body": "Города, трансферы, отели, активности — автоматически отсортированы по датам и часовым поясам.",
    "f.together.title": "Планируйте вместе",
    "f.together.body": "Приглашайте друзей и семью — даже без аккаунта — и редактируйте поездку командой с понятными ролями.",
    "f.ai.title": "ИИ-планировщик поездки",
    "f.ai.body": "Опишите, какую поездку хотите, и получите готовый черновик маршрута за секунды.",
    "f.concierge.title": "ИИ-консьерж в Telegram и WhatsApp",
    "f.concierge.body": "Умные напоминания о заезде, дедлайнах отмены и вылетах — плюс ИИ-ассистент прямо в чате.",
    "f.budget.title": "Бюджет в любой валюте",
    "f.budget.body": "Тратьте в любой валюте. Triplanio автоматически собирает все брони по реальному курсу.",
    "mini.hotels": "Отели",
    "mini.flights": "Перелёты",
    "mini.activities": "Активности",
    "mini.food": "Еда",
    "mini.transfers": "Трансферы",
    "mini.food_misc": "Еда и прочее",
    "mini.under": "−€180 от плана",
    "mini.under_plan": "−€180 от плана",
    "mini.total": "Итого по поездке",
    "mini.home_ccy": "Валюта · EUR · живой курс",
    "how.eyebrow": "Как это работает",
    "how.h2": "От идеи до маршрута за три шага.",
    "how.s1.title": "Создайте поездку",
    "how.s1.body": "Добавьте направления, даты и участников. Triplanio создаст каркас.",
    "how.s2.title": "Добавьте детали — или дайте это ИИ",
    "how.s2.body": "Отели, рейсы, трансферы, активности. ИИ-планировщик составит маршрут за вас.",
    "how.s3.title": "Путешествуйте вместе, без стресса",
    "how.s3.body": "Делитесь с попутчиками, получайте напоминания, ведите бюджет.",
    "thumb.new_trip": "Новая поездка",
    "thumb.where": "Куда",
    "thumb.from": "С",
    "thumb.to": "По",
    "thumb.organizer": "Вы · организатор",
    "thumb.travelers": "+ 3 путешественника",
    "thumb.from_date": "12 июля",
    "thumb.to_date": "23 июля",
    "thumb.ai_planner": "ИИ-планировщик",
    "thumb.ai_prompt": "«11 дней, 4 человека, неспешно, океан, без музеев.»",
    "thumb.ai_result_1": "Лиссабон · 4 ночи · база в Алфаме",
    "thumb.ai_result_2": "Порту · 2 ночи · виды на реку",
    "thumb.ai_result_3": "Барселона · 5 ночей · у моря",
    "thumb.day_of_travel": "День поездки",
    "thumb.cancel_msg": "Бесплатная отмена Memmo Alfama заканчивается через 2 дня.",
    "thumb.confirm": "Подтвердить",
    "thumb.confirmed": "Подтверждено · добавлено в таймлайн",
    "dd.eyebrow": "Ближе к делу",
    "dd.h2": "Продукт в деталях.",
    "dd.threeviews.eyebrow": "Таймлайн · Календарь · Карта",
    "dd.threeviews.title": "Одна поездка — три ракурса.",
    "dd.threeviews.body": "Переключайтесь между таймлайн, календарём и картой.",
    "dd.threeviews.h1": "Кликните по городу — раскроется детально",
    "dd.threeviews.h2": "Перетаскивайте активности, чтобы менять порядок",
    "dd.threeviews.h3": "Карта подстраивается по мере роста поездки",
    "dd.planner.eyebrow": "ИИ-планировщик",
    "dd.planner.title": "ИИ, который правда планирует поездку.",
    "dd.planner.body": "Скажите куда хотите, и получите черновик маршрута за секунды.",
    "dd.planner.h1": "Маршруты по нескольким городам",
    "dd.planner.h2": "Реалистичный ритм",
    "dd.planner.h3": "Редактируется, как обычный план",
    "dd.concierge.eyebrow": "Telegram и WhatsApp",
    "dd.concierge.title": "Travel-консьерж в кармане.",
    "dd.concierge.body": "Умные напоминания с учётом часовых поясов. ИИ отвечает на вопросы прямо в чате.",
    "dd.concierge.h1": "Умные напоминания с учётом часовых поясов",
    "dd.concierge.h2": "«Какой адрес отеля?» — мгновенный ответ",
    "dd.concierge.h3": "Можно выключить для отдельной поездки",
    "dd.budget.eyebrow": "Умный бюджет",
    "dd.budget.title": "Настоящий бюджет, в любой валюте.",
    "dd.budget.body": "Triplanio автоматически собирает стоимость всех бронирований в общий бюджет по актуальному курсу.",
    "dd.budget.h1": "Автоматически из бронирований",
    "dd.budget.h2": "Живой курс или ручной",
    "dd.budget.h3": "Свои категории",
    "planner.user_msg": "11 дней · 4 человека · Иберия · неспешно · океан · без музеев.",
    "planner.ai_msg": "Строю маршрут от Лиссабона на север по побережью до Барселоны…",
    "planner.res_lisbon": "Лиссабон · 4 ночи",
    "planner.res_lisbon_sub": "Алфама, морской свет, неторопливые утра",
    "planner.res_train": "Лиссабон → Порту",
    "planner.res_train_sub": "Alfa Pendular · 2ч 50м · 08:39",
    "planner.res_porto": "Порту · 2 ночи",
    "planner.res_porto_sub": "Виды на Дору, без музейной повестки",
    "planner.res_flight": "Порту → Барселона",
    "planner.res_flight_sub": "Vueling 6602 · 2ч 20м",
    "planner.badge_stay": "Отель",
    "planner.badge_transfer": "Трансфер",
    "planner.badge_flight": "Перелёт",
    "phone.via": "через Telegram · в сети",
    "phone.today": "Сегодня · 09:14",
    "phone.b1": "Внимание — поезд в Порту через 4ч 25м. Выходите из отеля к 14:10.",
    "phone.u1": "На какой платформе?",
    "phone.b2": "Sta. Apolónia · платформа 3. Места — вагон 22, 41A–D.",
    "phone.u2": "Адрес отеля в Порту?",
    "phone.b3": "Torel Avantgarde — R. da Restauração 336, Porto. Заезд с 14:00.",
    "trust.languages": "Мультиязычная платформа",
    "trust.devices": "Работает на любом устройстве — без установки",
    "trust.privacy": "Приватно по умолчанию — поездка только ваша",
    "trust.free": "Бесплатный старт, навсегда",
    "faq.eyebrow": "Вопросы",
    "faq.h2": "Часто спрашивают.",
    "faq.lede": "Короткие ответы на то, что спрашивают первым делом.",
    "faq.q1": "Triplanio бесплатный?",
    "faq.a1": "Да. Вы можете спланировать поездку от начала до конца бесплатно. Некоторые продвинутые возможности входят в опциональный план Pro.",
    "faq.q2": "Можно ли пригласить тех, у кого нет аккаунта?",
    "faq.a2": "Да. Добавляйте их как офлайн-участников; когда будете готовы, отправьте приглашение.",
    "faq.q3": "Поддерживает ли Triplanio несколько языков?",
    "faq.a3": "Да. Переключите язык в шапке когда удобно.",
    "faq.q4": "Как работает ИИ?",
    "faq.a4": "Он создаёт черновик маршрута по вашему описанию. Всё можно редактировать.",
    "faq.q5": "Можно ли вести общие расходы?",
    "faq.a5": "Да. Бюджет поддерживает мультивалютные траты и разделение расходов.",
    "faq.q6": "Мои данные останутся приватными?",
    "faq.a6": "Да. Поездки видны только вам и тем, кого вы пригласили.",
    "faq.q7": "Нужно ли устанавливать приложение?",
    "faq.a7": "Нет. Triplanio работает в любом современном браузере.",
    "finalcta.h2": "Ваша следующая поездка заслуживает большего, чем 12 вкладок.",
    "finalcta.lede": "Начните за минуту. Бесплатно, без банковской карты.",
    "finalcta.cta": "Начать планировать",
    "footer.tagline": "Планируйте, делитесь, путешествуйте.",
    "footer.product": "Продукт",
    "footer.features": "Возможности",
    "footer.how": "Как это работает",
    "footer.faq": "Вопросы",
    "footer.company": "Компания",
    "footer.about": "О нас",
    "footer.contact": "Контакты",
    "footer.legal": "Юридическое",
    "footer.privacy": "Конфиденциальность",
    "footer.terms": "Условия",
    "footer.copy": "© 2026 Triplanio",
  },
  ES: {
    "nav.features": "Funciones",
    "nav.how": "Cómo funciona",
    "nav.faq": "Preguntas",
    "header.cta": "Empezar a planear",
    "lang.label": "Idioma",
    "hero.h1_a": "Todo tu viaje.",
    "hero.h1_b_accent": "Un",
    "hero.h1_c": "plan precioso.",
    "hero.lede": "Crea itinerarios entre varias ciudades, planea en equipo y lleva el presupuesto en cualquier divisa.",
    "hero.cta_primary": "Empezar a planear",
    "hero.cta_secondary": "Ver cómo funciona",
    "hero.trust_free": "Gratis para empezar",
    "hero.trust_no_card": "Sin tarjeta de crédito",
    "hero.trust_languages": "Plataforma multilingüe",
    "mockup.trips": "Viajes",
    "mockup.this_trip": "Este viaje",
    "mockup.trip_title": "Iberia — Verano '26",
    "mockup.subtitle": "12 jul → 23 jul · 3 ciudades · 4 viajeros",
    "mockup.tab_timeline": "Línea de tiempo",
    "mockup.tab_calendar": "Calendario",
    "mockup.tab_map": "Mapa",
    "mockup.nights_4": "Lisboa · 4 noches",
    "mockup.nights_2": "Oporto · 2 noches",
    "mockup.nights_5": "Barcelona · 5 noches",
    "mockup.other_trip_1": "Japón en temporada de cerezos",
    "mockup.other_trip_2": "Trek por la Patagonia",
    "mockup.tag_flight": "Vuelo",
    "mockup.tag_hotel": "Hotel",
    "mockup.tag_activity": "Actividad",
    "mockup.tag_transfer": "Traslado",
    "mockup.checkin": "check-in",
    "mockup.day1": "Sáb · 12 jul",
    "mockup.day2": "Dom · 13 jul",
    "mockup.day3": "Mié · 16 jul",
    "float.trip_budget": "Presupuesto del viaje",
    "float.leave_at_title": "Sal a las 14:10",
    "float.leave_at_sub": "Tren a Oporto, 30 min del hotel",
    "city.lisbon": "Lisboa",
    "city.porto": "Oporto",
    "city.barcelona": "Barcelona",
    "problem.eyebrow": "Antes de Triplanio",
    "problem.h2_a": "Tu viaje vive en 12 pestañas",
    "problem.h2_b": "y una app de notas.",
    "problem.lede": "Reservas en el correo. Vuelos en capturas. El itinerario en un Google Doc que nadie más abrió.",
    "problem.handoff": "Triplanio lo reúne todo.",
    "problem.inbox": "Bandeja · 3 de 12",
    "problem.mail1_from": "Booking.com",
    "problem.mail1_subj": "Memmo Alfama — Tu reserva está confirmada (LIS)",
    "problem.mail2_from": "British Airways",
    "problem.mail2_subj": "E-ticket BA503 LHR → LIS · Sáb 12 jul · Asiento 14A",
    "problem.mail3_from": "Comboios de Portugal",
    "problem.mail3_subj": "Alfa Pendular · Lisboa → Oporto",
    "problem.notes_title": "plan iberia v3 (de verdad)",
    "problem.notes_body_html": "· lisboa: reservar tranvía 28 ??<br/>· preguntar a mike por las bodegas<br/>· barcelona airbnb — ¿enlace?",
    "problem.tab1": "Tripadvisor — Lisboa",
    "problem.tab2": "Google Doc · Itinerario",
    "problem.tab3": "Booking · Oporto",
    "problem.tab4": "Mapas",
    "problem.tabs_body": "12 pestañas · 4 ventanas · ¿en cuál estaba el alquiler?",
    "features.eyebrow": "Funciones",
    "features.h2": "Todo lo que tu viaje necesita, en un solo lugar.",
    "features.lede": "Cinco cosas que Triplanio hace para cambiar cómo planeas.",
    "f.timeline.title": "Línea de tiempo todo en uno",
    "f.timeline.body": "Ciudades, traslados, hoteles y actividades — ordenados automáticamente.",
    "f.together.title": "Planea en equipo",
    "f.together.body": "Invita a familia y amigos — incluso sin cuenta — y edita en equipo.",
    "f.ai.title": "Planificador de viajes con IA",
    "f.ai.body": "Describe el viaje y recibe un itinerario completo en segundos.",
    "f.concierge.title": "Conserje de viajes con IA en Telegram y WhatsApp",
    "f.concierge.body": "Recordatorios inteligentes y un asistente de IA directamente en el chat.",
    "f.budget.title": "Presupuesto multimoneda",
    "f.budget.body": "Gasta en cualquier moneda con tipos de cambio reales.",
    "mini.hotels": "Hoteles",
    "mini.flights": "Vuelos",
    "mini.activities": "Actividades",
    "mini.food": "Comida",
    "mini.transfers": "Traslados",
    "mini.food_misc": "Comida y otros",
    "mini.under": "€180 menos",
    "mini.under_plan": "€180 por debajo del plan",
    "mini.total": "Total del viaje",
    "mini.home_ccy": "Moneda · EUR · cambio en vivo",
    "how.eyebrow": "Cómo funciona",
    "how.h2": "De la idea al itinerario en tres pasos.",
    "how.s1.title": "Crea tu viaje",
    "how.s1.body": "Añade destinos, fechas y compañeros.",
    "how.s2.title": "Añade los detalles — o deja que la IA lo haga",
    "how.s2.body": "Hoteles, vuelos, traslados. La IA crea el itinerario completo.",
    "how.s3.title": "Viaja en equipo, con menos estrés",
    "how.s3.body": "Comparte, recibe recordatorios y controla el presupuesto.",
    "thumb.new_trip": "Nuevo viaje",
    "thumb.where": "Dónde",
    "thumb.from": "Desde",
    "thumb.to": "Hasta",
    "thumb.organizer": "Tú · organizador",
    "thumb.travelers": "+ 3 viajeros",
    "thumb.from_date": "12 jul",
    "thumb.to_date": "23 jul",
    "thumb.ai_planner": "Planificador IA",
    "thumb.ai_prompt": "«11 días, 4 personas, ritmo lento, baños en el mar, sin museos.»",
    "thumb.ai_result_1": "Lisboa · 4 noches · base en Alfama",
    "thumb.ai_result_2": "Oporto · 2 noches · vistas al río",
    "thumb.ai_result_3": "Barcelona · 5 noches · junto al mar",
    "thumb.day_of_travel": "Día de viaje",
    "thumb.cancel_msg": "La cancelación gratis de Memmo Alfama termina en 2 días.",
    "thumb.confirm": "Confirmar",
    "thumb.confirmed": "Confirmado · sincronizado en tu línea de tiempo",
    "dd.eyebrow": "De cerca",
    "dd.h2": "El producto, en detalle.",
    "dd.threeviews.eyebrow": "Línea de tiempo · Calendario · Mapa",
    "dd.threeviews.title": "Un viaje, tres vistas.",
    "dd.threeviews.body": "Cambia entre línea de tiempo, calendario y mapa.",
    "dd.threeviews.h1": "Haz clic en una ciudad para ver los detalles",
    "dd.threeviews.h2": "Arrastra para reordenar las actividades",
    "dd.threeviews.h3": "El mapa se adapta a medida que crece el viaje",
    "dd.planner.eyebrow": "Planificador con IA",
    "dd.planner.title": "Una IA que realmente planea el viaje.",
    "dd.planner.body": "Dile adónde quieres ir y recibe un itinerario en segundos.",
    "dd.planner.h1": "Rutas multiciudad",
    "dd.planner.h2": "Ritmo realista",
    "dd.planner.h3": "Editable como cualquier plan hecho a mano",
    "dd.concierge.eyebrow": "Telegram y WhatsApp",
    "dd.concierge.title": "Un conserje de viajes en tu bolsillo.",
    "dd.concierge.body": "Avisos inteligentes según tu zona horaria. Pregúntale lo que quieras.",
    "dd.concierge.h1": "Recordatorios con zona horaria",
    "dd.concierge.h2": "«¿Cuál es la dirección del hotel?» respondido al instante",
    "dd.concierge.h3": "Silencia por viaje",
    "dd.budget.eyebrow": "Presupuesto inteligente",
    "dd.budget.title": "Presupuestos reales, en cualquier moneda.",
    "dd.budget.body": "Triplanio reúne precios de hoteles y actividades con tipos de cambio en tiempo real.",
    "dd.budget.h1": "Agrupado desde tus reservas",
    "dd.budget.h2": "Tipos en vivo o manuales",
    "dd.budget.h3": "Categorías personalizadas",
    "planner.user_msg": "11 días · 4 personas · Iberia · ritmo lento · mar · sin museos.",
    "planner.ai_msg": "Trazando ruta desde Lisboa hasta Barcelona…",
    "planner.res_lisbon": "Lisboa · 4 noches",
    "planner.res_lisbon_sub": "Alfama, luz del océano, mañanas tranquilas",
    "planner.res_train": "Lisboa → Oporto",
    "planner.res_train_sub": "Alfa Pendular · 2h 50m · 08:39",
    "planner.res_porto": "Oporto · 2 noches",
    "planner.res_porto_sub": "Vistas al Duero, sin agenda de museos",
    "planner.res_flight": "Oporto → Barcelona",
    "planner.res_flight_sub": "Vueling 6602 · 2h 20m",
    "planner.badge_stay": "Estancia",
    "planner.badge_transfer": "Traslado",
    "planner.badge_flight": "Vuelo",
    "phone.via": "por Telegram · en línea",
    "phone.today": "Hoy · 09:14",
    "phone.b1": "El tren a Oporto sale en 4h 25m. Sal del hotel a las 14:10.",
    "phone.u1": "¿En qué andén?",
    "phone.b2": "Sta. Apolónia · andén 3. Plazas — coche 22, 41A–D.",
    "phone.u2": "¿Dirección del hotel en Oporto?",
    "phone.b3": "Torel Avantgarde — R. da Restauração 336, Porto. Check-in desde las 14:00.",
    "trust.languages": "Plataforma multilingüe",
    "trust.devices": "Funciona en cualquier dispositivo — sin instalar nada",
    "trust.privacy": "Privado por defecto — tu viaje es tuyo",
    "trust.free": "Gratis para empezar, para siempre",
    "faq.eyebrow": "Preguntas",
    "faq.h2": "Preguntas frecuentes.",
    "faq.lede": "Respuestas breves a lo que se pregunta primero.",
    "faq.q1": "¿Triplanio es gratis?",
    "faq.a1": "Sí. Puedes planear un viaje completo sin pagar. Algunas funciones avanzadas forman parte del plan Pro.",
    "faq.q2": "¿Puedo invitar a personas sin cuenta?",
    "faq.a2": "Sí. Añádelos como participantes sin conexión y envíales una invitación cuando estés listo.",
    "faq.q3": "¿Triplanio es multilingüe?",
    "faq.a3": "Sí. Cambia de idioma en cualquier momento desde el encabezado.",
    "faq.q4": "¿Cómo funciona la IA?",
    "faq.a4": "Genera borradores de itinerario a partir de tu descripción. Todo se puede editar.",
    "faq.q5": "¿Puedo registrar gastos compartidos?",
    "faq.a5": "Sí. El módulo de presupuesto admite gastos en varias monedas y división por partes.",
    "faq.q6": "¿Mis datos seguirán siendo privados?",
    "faq.a6": "Sí. Tus viajes son visibles solo para ti y las personas que invites.",
    "faq.q7": "¿Necesito instalar una app?",
    "faq.a7": "No. Triplanio funciona en cualquier navegador moderno.",
    "finalcta.h2": "Tu próximo viaje merece algo mejor que 12 pestañas.",
    "finalcta.lede": "Empieza a planear en menos de un minuto. Gratis, sin tarjeta.",
    "finalcta.cta": "Empezar a planear",
    "footer.tagline": "Planea, comparte, viaja.",
    "footer.product": "Producto",
    "footer.features": "Funciones",
    "footer.how": "Cómo funciona",
    "footer.faq": "Preguntas",
    "footer.company": "Empresa",
    "footer.about": "Sobre nosotros",
    "footer.contact": "Contacto",
    "footer.legal": "Legal",
    "footer.privacy": "Privacidad",
    "footer.terms": "Términos",
    "footer.copy": "© 2026 Triplanio",
  },
};

const LangCtx = createContext('EN');

function useT() {
  const lang = useContext(LangCtx);
  return useCallback(
    (key) => {
      const dict = TRANSLATIONS[lang] || TRANSLATIONS.EN;
      if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
      if (Object.prototype.hasOwnProperty.call(TRANSLATIONS.EN, key)) return TRANSLATIONS.EN[key];
      return key;
    },
    [lang]
  );
}

function detectLang() {
  try {
    const stored = localStorage.getItem('triplanio.lang');
    if (stored && ['EN','RU','ES'].includes(stored)) return stored;
  } catch (_) {}
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (nav === 'ru') return 'RU';
  if (nav === 'es') return 'ES';
  return 'EN';
}

/* ── Icons ── */
const TRIPLANIO_PATH = "M33.9515 -0.266535C40.7142 -0.445139 48.1271 -0.302259 54.9281 -0.303644L94.514 -0.309503L214.845 -0.305597L278.868 -0.306574L298.193 -0.318292C310.201 -0.32163 319.364 -0.684415 329.217 7.74225C343.125 19.635 341.19 34.942 341.176 51.3067L341.157 86.3829L341.184 195.125L341.181 272.228L341.212 295.303C341.226 308.706 342.006 318.931 332.398 329.72C326.281 336.547 317.675 340.628 308.52 341.05C298.456 341.533 284.325 341.086 274.023 341.083L205.381 341.092L162.115 341.117C141.323 341.131 123.861 343.106 107.208 327.72C102.838 323.62 99.3189 318.699 96.8548 313.236C94.3907 307.774 93.0296 301.878 92.849 295.889C92.529 287.072 93.8616 280.992 96.6224 272.786C101.665 257.797 109.31 248.589 119.725 237.345C125.95 245.136 131.667 253.986 137.971 261.606C140.39 264.528 150.129 252.175 148.683 246.961C146.168 237.892 141.381 229.908 138.15 221.158C142.842 216.992 148.474 212.5 153.326 208.398C163.06 200.169 172.732 191.869 182.345 183.5C189.212 190.011 196.381 197.442 203.098 204.167L248.907 249.981C253.187 244.922 256.537 238.164 256.598 231.434C256.623 228.623 256.007 225.923 254.626 223.456C251.646 218.12 237.029 204.664 231.868 199.467C223.676 191.542 215.284 182.914 207.203 174.842L155.649 123.287L134.288 101.945C132.743 100.406 131.158 98.7783 129.626 97.3106C123.616 91.552 120.034 86.1564 110.778 87.3673C103.826 88.2767 99.8349 91.3194 94.4329 95.3995C110.556 111.824 126.807 128.124 143.183 144.297C148.913 150.046 155.228 156.051 160.75 161.915C157.391 166.37 151.717 172.659 147.998 177.059C139.745 186.812 131.56 196.623 123.442 206.489C118.102 204.22 112.747 201.983 107.379 199.78C101.261 197.23 96.1995 193.797 89.9368 198.428C79.7224 205.983 80.7549 205.52 89.9857 212.164C94.9362 215.725 102.289 220.689 106.734 224.759C102.849 229.003 98.6343 233.317 95.2406 237.848C77.4842 261.564 66.952 294.342 80.972 322.417C84.8667 330.214 88.4217 334.775 94.4671 341.075C74.9177 341.309 55.209 340.956 35.6429 341.125C25.3518 341.214 16.7477 338.183 9.43489 330.636C5.11961 326.154 2.09948 320.587 0.695637 314.525C-0.740455 308.276 -0.261685 293.256 -0.261394 286.203C-0.338339 274.2 -0.331163 262.2 -0.240887 250.2C4.18863 255.291 9.4218 259.623 15.2513 263.023C32.4055 272.939 50.165 274.236 69.1761 269.211C69.6238 268.23 70.0656 266.844 70.4095 265.786C72.6759 258.811 75.6942 252.497 79.2786 246.108C67.5692 251.37 57.4925 254.32 44.432 253.45C20.0121 252.083 0.660326 229.606 -0.104168 205.7C-0.510832 192.989 -0.272964 179.798 -0.270183 166.97L-0.275066 95.5186L-0.277019 53.2891C-0.286758 47.0065 -0.647595 34.579 0.182942 28.8214C1.1558 22.1467 4.06527 15.9035 8.55013 10.8653C15.5012 3.17884 23.8502 0.199571 33.9515 -0.266535ZM137.352 52.7081C134.062 49.9494 128.015 49.4695 123.791 49.9737C116.528 51.2496 110.458 54.6421 104.987 59.5674L279.767 234.294L284.439 238.919C289.858 231.455 294.445 222.683 293.148 213.136C292.014 204.797 284.255 198.958 278.489 193.235L260.278 175.103L196.142 110.966L155.937 70.7413C150.064 64.881 143.662 58.0002 137.352 52.7081ZM256.192 105.029C259.319 96.1169 261.478 84.3761 247.586 85.7911C231.37 88.8299 220.289 99.6272 209.231 111.022L227.431 129.133L233.775 135.479C242.589 125.851 251.686 117.855 256.192 105.029Z";

function TriplanioMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 341 341" aria-hidden="true">
      <path d={TRIPLANIO_PATH} fill="#2167e2" />
    </svg>
  );
}

function Icon({ name, size = 20, stroke = 'currentColor', strokeWidth = 1.6, fill = 'none', ...rest }) {
  const paths = {
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2z" /></>,
    timeline: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8" /><path d="M10 6h10" /><path d="M10 12h7" /><path d="M10 18h10" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.6" /><path d="M15 14c3 0 6 1.8 6 5" /></>,
    sparkles: <><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z" /><path d="M19 16l.7 1.9L21.6 18.6 19.7 19.3 19 21.2 18.3 19.3 16.4 18.6 18.3 17.9 19 16z" /></>,
    chat: <><path d="M21 12a8 8 0 1 1-3.1-6.3" /><path d="M21 5v4h-4" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    wallet: <><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2H5a2 2 0 0 1-2-2z" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7H7a2 2 0 0 1-2-2" /><circle cx="16" cy="14" r="1.4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    devices: <><rect x="2" y="5" width="14" height="10" rx="1.5" /><path d="M6 19h6" /><path d="M9 15v4" /><rect x="17" y="9" width="5" height="11" rx="1.2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    gift: <><rect x="3" y="9" width="18" height="5" rx="1.2" /><path d="M4 14v7h16v-7" /><path d="M12 9v12" /><path d="M12 9c-2 0-4-1-4-3a2 2 0 0 1 4 0c0 2-2 3-4 3" /><path d="M12 9c2 0 4-1 4-3a2 2 0 0 0-4 0c0 2 2 3 4 3" /></>,
    map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16" /><path d="M9 3v4M15 3v4" /></>,
    bed: <><path d="M3 18v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7" /><path d="M3 14h18" /><path d="M3 18v3M21 18v3" /><circle cx="8" cy="11.5" r="1.4" /></>,
    plane: <path d="M21 12.5 3 18l4-5-4-5 18 5.5a.5.5 0 0 1 0 1z" />,
    train: <><rect x="6" y="4" width="12" height="13" rx="3" /><path d="M6 11h12" /><path d="M9 17l-2 3M15 17l2 3" /><circle cx="9" cy="14" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r=".8" fill="currentColor" stroke="none" /></>,
    cam: <><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.5" /><path d="M8 7l1.5-2h5L16 7" /></>,
    check: <path d="m5 12 4 4 10-10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
    arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    twitter: <path d="M18.2 4h2.7l-5.9 6.8L22 20h-5.5l-4.3-5.6L7 20H4.2l6.4-7.3L4 4h5.6l3.9 5.1L18.2 4Zm-1 14.4h1.5L7.1 5.5H5.5l11.7 12.9Z" fill="currentColor" stroke="none" />,
    instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" /></>,
    telegram: <path d="m4 12 16-7-3 16-5-5-2.5 4-1-5L4 12Zm5.5 1.6 8-6.4-9.5 5.4L9.5 13.6Z" fill="currentColor" stroke="none" />,
    whatsapp: <path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Zm5.1 12.7c-.2.6-1.2 1.1-1.7 1.2-.5.1-1 .1-1.5 0a7.3 7.3 0 0 1-2.8-1.3 9 9 0 0 1-2.8-3.3c-.3-.5-.5-1-.5-1.5 0-.6.3-1 .5-1.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4l.7 1.6c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.3-.1.6.2.4.7 1.1 1.3 1.6.7.6 1.4.9 1.7 1 .3.1.5.1.7-.1l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.3.2.4.3.4.4.1.1.1.6 0 1.2Z" fill="currentColor" stroke="none" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}

/* ── Flag ── */
function Flag({ kind, width = 18, height = 12 }) {
  const common = { width, height, style: { display:'block', borderRadius:2, overflow:'hidden', border:'1px solid rgba(0,0,0,.08)', flex:'0 0 auto' }, 'aria-hidden':true };
  if (kind === 'en') return (
    <svg {...common} viewBox="0 0 60 30">
      <defs><clipPath id="f-en-c"><rect width="60" height="30"/></clipPath><clipPath id="f-en-t"><path d="M30,15 h30 v15 z v-30 h-30 z h-30 v-15 z v30 h30 z"/></clipPath></defs>
      <g clipPath="url(#f-en-c)">
        <rect width="60" height="30" fill="#012169"/>
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6"/>
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#f-en-t)" stroke="#C8102E" strokeWidth="4"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6"/>
      </g>
    </svg>
  );
  if (kind === 'ru') return <svg {...common} viewBox="0 0 9 6"><rect width="9" height="6" fill="#fff"/><rect width="9" height="4" y="2" fill="#0033A0"/><rect width="9" height="2" y="4" fill="#DA291C"/></svg>;
  if (kind === 'es') return <svg {...common} viewBox="0 0 12 8"><rect width="12" height="8" fill="#AA151B"/><rect width="12" height="4" y="2" fill="#F1BF00"/></svg>;
  return null;
}

const LANGS = [
  { code:'EN', label:'English', flag:'en' },
  { code:'RU', label:'Русский', flag:'ru' },
  { code:'ES', label:'Español', flag:'es' },
];

function LangDropdown({ value, onChange, direction = 'down' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = LANGS.find((l) => l.code === value) || LANGS[0];
  return (
    <div className={`langdd ${open ? 'is-open' : ''} ${direction === 'up' ? 'langdd--up' : ''}`} ref={ref}>
      <button type="button" className="langdd__btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={t('lang.label')} onClick={() => setOpen(v => !v)}>
        <Flag kind={current.flag} width={18} height={12} />
        <span>{current.code}</span>
        <Icon name="chevron" size={12} className="chev" style={{ transform:'rotate(90deg)' }} />
      </button>
      <div className="langdd__menu" role="listbox" aria-label={t('lang.label')}>
        {LANGS.map(l => (
          <button key={l.code} type="button" role="option" aria-checked={l.code === value}
            className="langdd__item" onClick={() => { onChange(l.code); setOpen(false); }}>
            <Flag kind={l.flag} width={22} height={16} />
            <span className="label">{l.label}</span>
            <span className="code">{l.code}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Header ── */
const NAV = [
  { tkey:'nav.features', href:'#features' },
  { tkey:'nav.how', href:'#how' },
  { tkey:'nav.faq', href:'#faq' },
];

function LandingHeader({ lang, setLang }) {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive:true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <>
      <header className={`header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="container header__inner">
          <a href="#top" className="brand" aria-label="Triplanio — home">
            <span className="brand__mark"><TriplanioMark /></span>
            <span>Triplanio</span>
          </a>
          <nav className="nav" aria-label="Primary">
            {NAV.map(n => <a key={n.href} href={n.href}>{t(n.tkey)}</a>)}
          </nav>
          <div className="header__right">
            <LangDropdown value={lang} onChange={setLang} />
            <button className="btn btn--primary" onClick={() => nav(ctaTarget)}>{t('header.cta')}</button>
            <button className="hamburger" aria-label={t('lang.label')} aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(v => !v)}>
              <Icon name={drawerOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
      </header>
      <div className={`drawer ${drawerOpen ? 'is-open' : ''}`} aria-hidden={!drawerOpen}>
        <ul>
          {NAV.map(n => (
            <li key={n.href}><a href={n.href} onClick={() => setDrawerOpen(false)}>{t(n.tkey)}</a></li>
          ))}
        </ul>
        <div className="drawer__lang"><LangDropdown value={lang} onChange={setLang} /></div>
      </div>
    </>
  );
}

/* ── Hero ── */
function HeroMockup() {
  const t = useT();
  return (
    <div className="app-frame" role="img" aria-label={t('mockup.trip_title')}>
      <div className="app-frame__bar">
        <span className="dot dot--r"/><span className="dot dot--y"/><span className="dot dot--g"/>
        <span className="url">triplanio.com / iberia-summer-26</span>
      </div>
      <div className="app-frame__body">
        <aside className="app-sidebar" aria-hidden="true">
          <div className="app-sidebar__group">{t('mockup.trips')}</div>
          <div className="app-sidebar__item is-active"><span className="swatch swatch--lisbon"/>{t('mockup.trip_title')}</div>
          <div className="app-sidebar__item"><span className="swatch" style={{background:'#8693a8'}}/>{t('mockup.other_trip_1')}</div>
          <div className="app-sidebar__item"><span className="swatch" style={{background:'#8693a8'}}/>{t('mockup.other_trip_2')}</div>
          <div className="app-sidebar__group">{t('mockup.this_trip')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--lisbon"/>{t('mockup.nights_4')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--porto"/>{t('mockup.nights_2')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--bcn"/>{t('mockup.nights_5')}</div>
        </aside>
        <div className="app-main">
          <div className="app-main__head">
            <div>
              <div className="app-main__title">{t('mockup.trip_title')}</div>
              <div className="app-main__subtitle">{t('mockup.subtitle')}</div>
            </div>
            <div className="app-tabs" aria-hidden="true">
              <span className="app-tab is-active">{t('mockup.tab_timeline')}</span>
              <span className="app-tab">{t('mockup.tab_calendar')}</span>
              <span className="app-tab">{t('mockup.tab_map')}</span>
            </div>
          </div>
          <div className="tl">
            <div className="tl__day" data-day={t('mockup.day1')}>
              <div className="tl-card"><span className="icon"><Icon name="plane"/></span><span><strong>LHR → LIS</strong> · British Airways 503</span><span className="tag">{t('mockup.tag_flight')}</span><span className="meta">10:25</span></div>
              <div className="tl-card"><span className="icon"><Icon name="bed"/></span><span><strong>Memmo Alfama</strong> · {t('mockup.checkin')}</span><span className="tag tag--green">{t('mockup.tag_hotel')}</span><span className="meta">15:00</span></div>
            </div>
            <div className="tl__day tl__day--accent" data-day={t('mockup.day2')}>
              <div className="tl-card"><span className="icon"><Icon name="cam"/></span><span><strong>Tram 28</strong> · Alfama loop</span><span className="tag tag--warm">{t('mockup.tag_activity')}</span><span className="meta">10:00</span></div>
              <div className="tl-card"><span className="icon"><Icon name="cam"/></span><span><strong>Pastéis de Belém</strong> · pastry crawl</span><span className="tag tag--warm">{t('mockup.tag_activity')}</span><span className="meta">15:30</span></div>
            </div>
            <div className="tl__day tl__day--green" data-day={t('mockup.day3')}>
              <div className="tl-card"><span className="icon"><Icon name="train"/></span><span><strong>Lisbon → Porto</strong> · Alfa Pendular</span><span className="tag">{t('mockup.tag_transfer')}</span><span className="meta">08:39</span></div>
              <div className="tl-card"><span className="icon"><Icon name="bed"/></span><span><strong>Torel Avantgarde</strong> · {t('mockup.checkin')}</span><span className="tag tag--green">{t('mockup.tag_hotel')}</span><span className="meta">14:00</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return (
    <section className="hero" id="top">
      <div className="container">
        <div className="hero__grid">
          <div className="hero__copy reveal">
            <h1>{t('hero.h1_a')}<span className="break"><span className="accent">{t('hero.h1_b_accent')}</span> {t('hero.h1_c')}</span></h1>
            <p className="hero__lede">{t('hero.lede')}</p>
            <div className="hero__ctas">
              <button className="btn btn--primary btn--lg" onClick={() => nav(ctaTarget)}>{t('hero.cta_primary')} <Icon name="arrowRight" size={16} className="chev"/></button>
              <a className="btn btn--ghost btn--lg" href="#how">{t('hero.cta_secondary')}</a>
            </div>
            <div className="hero__trust">
              <span>{t('hero.trust_free')}</span><span className="dot"/><span>{t('hero.trust_no_card')}</span><span className="dot"/><span>{t('hero.trust_languages')}</span>
            </div>
          </div>
          <div className="hero__visual reveal" style={{transitionDelay:'120ms'}}>
            <HeroMockup/>
            <div className="float float--budget" aria-hidden="true">
              <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase'}}>{t('float.trip_budget')}</div>
              <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:4}}>
                <strong style={{fontFamily:'var(--font-display)',fontSize:22,letterSpacing:'-0.02em',fontVariantNumeric:'tabular-nums'}}>€4,820</strong>
                <span style={{fontSize:11,color:'var(--muted)'}}>· $5,210 · ₽491k</span>
              </div>
            </div>
            <div className="float float--chat" aria-hidden="true">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg, var(--brand), #5b8fff)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>AI</span>
                <div style={{fontSize:12.5,lineHeight:1.3}}>
                  <div style={{fontWeight:600}}>{t('float.leave_at_title')}</div>
                  <div style={{color:'var(--muted)',fontSize:11.5}}>{t('float.leave_at_sub')}</div>
                </div>
              </div>
            </div>
            <div className="float float--pins" aria-hidden="true">
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,fontWeight:600}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--brand)'}}/>{t('city.lisbon')}
                <span style={{width:14,height:1,background:'var(--line)'}}/>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--warm)'}}/>{t('city.porto')}
                <span style={{width:14,height:1,background:'var(--line)'}}/>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--success)'}}/>{t('city.barcelona')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Problem ── */
function Problem() {
  const t = useT();
  return (
    <section className="section section--wash">
      <div className="container">
        <div className="problem reveal">
          <div>
            <span className="eyebrow">{t('problem.eyebrow')}</span>
            <h2 style={{marginTop:16}}>{t('problem.h2_a')}<br/>{t('problem.h2_b')}</h2>
            <p className="lede" style={{marginTop:18}}>{t('problem.lede')}</p>
          </div>
          <div className="collage" aria-hidden="true">
            <div className="collage__card collage__card--mail">
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:2,background:'#ea4335'}}/>
                <span style={{fontSize:11,fontWeight:700,color:'var(--muted)',letterSpacing:'.06em',textTransform:'uppercase'}}>{t('problem.inbox')}</span>
              </div>
              {[['B',t('problem.mail1_from'),t('problem.mail1_subj')],['BA',t('problem.mail2_from'),t('problem.mail2_subj')],['CP',t('problem.mail3_from'),t('problem.mail3_subj')]].map(([av,from,subj]) => (
                <div className="mailrow" key={from}>
                  <span className="avatar">{av}</span>
                  <div className="lines"><div className="from">{from}</div><div className="subj">{subj}</div></div>
                </div>
              ))}
            </div>
            <div className="collage__card collage__card--notes">
              <div style={{fontWeight:700,marginBottom:8}}>{t('problem.notes_title')}</div>
              <div style={{color:'#7c6b3a',lineHeight:1.6}} dangerouslySetInnerHTML={{__html:t('problem.notes_body_html')}}/>
            </div>
            <div className="collage__card collage__card--tabs">
              <div className="tabstrip">
                {[t('problem.tab1'),t('problem.tab2'),t('problem.tab3'),t('problem.tab4')].map(tab => <span className="t" key={tab}>{tab}</span>)}
              </div>
              <div className="tabsbody">{t('problem.tabs_body')}</div>
            </div>
          </div>
        </div>
        <p className="problem__handoff reveal">{t('problem.handoff')}</p>
      </div>
    </section>
  );
}

/* ── Features ── */
function BudgetMini() {
  const t = useT();
  const rows = [
    {k:'mini.hotels',pct:42,amt:'€2,025',ccy:'$2,190',color:'#2167e2'},
    {k:'mini.flights',pct:28,amt:'€1,350',ccy:'$1,460',color:'#5b8fff'},
    {k:'mini.activities',pct:18,amt:'€868',ccy:'$938',color:'#c9603a'},
    {k:'mini.food',pct:12,amt:'€577',ccy:'$624',color:'#1f8a5b'},
  ];
  return (
    <div className="budget" style={{padding:0}}>
      <div className="budget__total" style={{marginBottom:12}}>
        <span className="big" style={{fontSize:26}}>€4,820</span>
        <span className="delta">{t('mini.under')}</span>
      </div>
      <div className="budget__bar" style={{marginBottom:12}}>
        {rows.map(r => <i key={r.k} style={{width:`${r.pct}%`,background:r.color}}/>)}
      </div>
      <div className="budget__rows">
        {rows.map(r => (
          <div className="budget__row" key={r.k}>
            <span className="sw" style={{background:r.color}}/><span>{t(r.k)}</span>
            <span className="amt">{r.amt}</span><span className="ccy">{r.ccy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Features() {
  const t = useT();
  const FEATURES = [
    {icon:'timeline',titleKey:'f.timeline.title',bodyKey:'f.timeline.body'},
    {icon:'users',titleKey:'f.together.title',bodyKey:'f.together.body'},
    {icon:'sparkles',titleKey:'f.ai.title',bodyKey:'f.ai.body',warm:true},
    {icon:'telegram',titleKey:'f.concierge.title',bodyKey:'f.concierge.body'},
    {icon:'wallet',titleKey:'f.budget.title',bodyKey:'f.budget.body',wide:true},
  ];
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section__head reveal">
          <span className="eyebrow">{t('features.eyebrow')}</span>
          <h2>{t('features.h2')}</h2>
          <p className="lede" style={{margin:'14px auto 0'}}>{t('features.lede')}</p>
        </div>
        <div className="features">
          {FEATURES.map(f => (
            <article className={`card reveal ${f.wide?'card--wide':''}`} key={f.titleKey}>
              <div>
                <span className={`card__icon ${f.warm?'card__icon--warm':''}`}><Icon name={f.icon} size={22}/></span>
                <h3>{t(f.titleKey)}</h3>
                <p>{t(f.bodyKey)}</p>
              </div>
              {f.wide && <div className="preview" aria-hidden="true"><BudgetMini/></div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── How It Works ── */
function StepThumb({ kind }) {
  const t = useT();
  if (kind === 'create') return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('thumb.new_trip')}</div>
      <div style={{display:'grid',gap:8}}>
        <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize:12,color:'var(--ink)'}}>
          <span style={{color:'var(--muted)',marginRight:8}}>{t('thumb.where')}</span>{t('city.lisbon')} · {t('city.porto')} · {t('city.barcelona')}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize:12}}><span style={{color:'var(--muted)',marginRight:6}}>{t('thumb.from')}</span>{t('thumb.from_date')}</div>
          <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize:12}}><span style={{color:'var(--muted)',marginRight:6}}>{t('thumb.to')}</span>{t('thumb.to_date')}</div>
        </div>
        <div style={{display:'flex',gap:6,fontSize:11.5}}>
          <span style={{background:'rgba(33,103,226,.08)',color:'var(--brand)',padding:'3px 10px',borderRadius:999,fontWeight:600}}>{t('thumb.organizer')}</span>
          <span style={{background:'var(--wash)',color:'var(--muted)',padding:'3px 10px',borderRadius:999,fontWeight:600}}>{t('thumb.travelers')}</span>
        </div>
      </div>
    </div>
  );
  if (kind === 'ai') return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('thumb.ai_planner')}</div>
      <div style={{background:'var(--wash)',borderRadius:8,padding:'10px 12px',fontSize:12.5,color:'var(--ink-2)',lineHeight:1.5}}>{t('thumb.ai_prompt')}</div>
      <div style={{display:'grid',gap:6,marginTop:10}}>
        {['thumb.ai_result_1','thumb.ai_result_2','thumb.ai_result_3'].map(k => (
          <div key={k} style={{fontSize:12,padding:'8px 10px',background:'#fff',border:'1px solid var(--line)',borderRadius:8,display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--brand)'}}/>{t(k)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('thumb.day_of_travel')}</div>
      <div style={{display:'grid',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
          <span style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg, var(--brand), #5b8fff)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700}}>AI</span>
          <div style={{background:'#eef2f9',padding:'8px 10px',borderRadius:10,borderBottomLeftRadius:4}}>{t('thumb.cancel_msg')}</div>
        </div>
        <div style={{alignSelf:'flex-end',background:'var(--brand)',color:'#fff',padding:'8px 10px',borderRadius:10,borderBottomRightRadius:4,fontSize:12,maxWidth:'80%'}}>{t('thumb.confirm')}</div>
        <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,color:'var(--muted)'}}>
          <span style={{width:6,height:6,borderRadius:50,background:'var(--success)'}}/>{t('thumb.confirmed')}
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const t = useT();
  const steps = [
    {num:'1',kind:'create',titleKey:'how.s1.title',bodyKey:'how.s1.body'},
    {num:'2',kind:'ai',titleKey:'how.s2.title',bodyKey:'how.s2.body'},
    {num:'3',kind:'travel',titleKey:'how.s3.title',bodyKey:'how.s3.body'},
  ];
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section__head reveal" style={{marginBottom:64}}>
          <span className="eyebrow">{t('how.eyebrow')}</span>
          <h2>{t('how.h2')}</h2>
        </div>
        <div className="steps">
          {steps.map((s,i) => (
            <div className="step reveal" key={s.num} style={{transitionDelay:`${i*80}ms`}}>
              <span className="step__num">{s.num}</span>
              <h3>{t(s.titleKey)}</h3>
              <p>{t(s.bodyKey)}</p>
              <StepThumb kind={s.kind}/>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Deep Dives ── */
function ThreeViewsVisual() {
  const t = useT();
  const [view, setView] = useState('Map');
  const tabs = [{id:'Timeline',labelKey:'mockup.tab_timeline'},{id:'Calendar',labelKey:'mockup.tab_calendar'},{id:'Map',labelKey:'mockup.tab_map'}];
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:'1px solid var(--line-2)'}}>
        <div style={{fontSize:12,color:'var(--muted)',fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{t('mockup.trip_title')}</div>
        <div className="app-tabs">
          {tabs.map(tab => (
            <button key={tab.id} type="button" className={`app-tab ${view===tab.id?'is-active':''}`}
              onClick={() => setView(tab.id)} style={{cursor:'pointer',border:0}}>{t(tab.labelKey)}</button>
          ))}
        </div>
      </div>
      {view === 'Map' && (
        <div className="mapviz">
          <svg viewBox="0 0 600 320" preserveAspectRatio="none">
            <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dde3ee" strokeWidth="0.6"/></pattern></defs>
            <rect width="600" height="320" fill="url(#grid)"/>
            <path d="M40,240 Q90,200 130,210 T220,190 Q260,170 320,180 T440,160 Q500,150 560,170" fill="none" stroke="#cfd6e3" strokeWidth="1.5" strokeDasharray="4 4"/>
            <path d="M120,210 C200,180 240,200 290,170 C360,130 420,150 470,130" fill="none" stroke="#2167e2" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 6">
              <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1.2s" repeatCount="indefinite"/>
            </path>
          </svg>
          <div className="pin" style={{left:'20%',top:'70%'}}><span className="pin__dot"/><span className="pin__lbl">{t('city.lisbon')}</span></div>
          <div className="pin" style={{left:'48%',top:'55%'}}><span className="pin__dot" style={{background:'var(--warm)'}}/><span className="pin__lbl">{t('city.porto')}</span></div>
          <div className="pin" style={{left:'78%',top:'44%'}}><span className="pin__dot" style={{background:'var(--success)'}}/><span className="pin__lbl">{t('city.barcelona')}</span></div>
        </div>
      )}
      {view === 'Calendar' && (
        <div style={{padding:22}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6,fontSize:11.5}}>
            {['M','T','W','T','F','S','S'].map((d,i) => <div key={i} style={{textAlign:'center',color:'var(--muted)',fontWeight:600,padding:'4px 0'}}>{d}</div>)}
            {Array.from({length:28}).map((_,i) => {
              const day=i+1, inTrip=day>=12&&day<=23;
              const city=day<16?'lis':day<18?'transfer':day<19?'por':'bcn';
              const bg=!inTrip?'transparent':city==='lis'?'rgba(33,103,226,.18)':city==='por'?'rgba(201,96,58,.18)':city==='transfer'?'repeating-linear-gradient(45deg, rgba(33,103,226,.15) 0 4px, rgba(201,96,58,.15) 4px 8px)':'rgba(31,138,91,.18)';
              return <div key={i} style={{height:38,background:bg,borderRadius:8,display:'flex',alignItems:'flex-start',justifyContent:'flex-start',padding:6,fontSize:11,fontWeight:600,color:inTrip?'var(--ink)':'var(--muted-2)',border:inTrip?0:'1px solid var(--line-2)'}}>{day}</div>;
            })}
          </div>
          <div style={{display:'flex',gap:14,marginTop:12,fontSize:11.5,color:'var(--muted)'}}>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(33,103,226,.5)',borderRadius:3,marginRight:6}}/>{t('city.lisbon')}</span>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(201,96,58,.5)',borderRadius:3,marginRight:6}}/>{t('city.porto')}</span>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(31,138,91,.5)',borderRadius:3,marginRight:6}}/>{t('city.barcelona')}</span>
          </div>
        </div>
      )}
      {view === 'Timeline' && (
        <div style={{padding:22}}>
          <div style={{display:'grid',gap:8}}>
            {[
              {d:'Jul 12',title:`${t('mockup.tag_flight')} LHR → LIS`,tagKey:'mockup.tag_flight',color:'var(--brand)'},
              {d:'Jul 13',title:'Tram 28',tagKey:'mockup.tag_activity',color:'var(--warm)'},
              {d:'Jul 16',title:`${t('mockup.tag_transfer')} ${t('city.lisbon')} → ${t('city.porto')}`,tagKey:'mockup.tag_transfer',color:'var(--brand)'},
              {d:'Jul 18',title:`${t('mockup.tag_flight')} ${t('city.porto')} → BCN`,tagKey:'mockup.tag_flight',color:'var(--brand)'},
              {d:'Jul 21',title:'Sagrada Família',tagKey:'mockup.tag_activity',color:'var(--warm)'},
            ].map((r,i) => (
              <div key={i} style={{display:'grid',gridTemplateColumns:'70px 1fr auto',alignItems:'center',gap:10,background:'#fff',border:'1px solid var(--line)',borderRadius:10,padding:'10px 12px',fontSize:13}}>
                <span style={{color:'var(--muted)',fontWeight:600,fontSize:11.5}}>{r.d}</span>
                <span>{r.title}</span>
                <span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:'rgba(33,103,226,.08)',color:r.color,fontWeight:600}}>{t(r.tagKey)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlannerVisual() {
  const t = useT();
  return (
    <div className="chat" aria-hidden="true">
      <div className="bubble bubble--user">{t('planner.user_msg')}</div>
      <div className="bubble bubble--ai">{t('planner.ai_msg')}<div style={{marginTop:6}}><span className="typing"><span/><span/><span/></span></div></div>
      <div style={{display:'grid',gap:8,marginTop:4}}>
        {[
          {icon:'bed',name:t('planner.res_lisbon'),sub:t('planner.res_lisbon_sub'),badge:t('planner.badge_stay')},
          {icon:'train',name:t('planner.res_train'),sub:t('planner.res_train_sub'),badge:t('planner.badge_transfer')},
          {icon:'bed',name:t('planner.res_porto'),sub:t('planner.res_porto_sub'),badge:t('planner.badge_stay')},
          {icon:'plane',name:t('planner.res_flight'),sub:t('planner.res_flight_sub'),badge:t('planner.badge_flight')},
        ].map((r,i) => (
          <div className="planresult" key={i}>
            <Icon name={r.icon}/><div><strong>{r.name}</strong><div style={{color:'var(--muted)',fontSize:11.5}}>{r.sub}</div></div>
            <span className="badge">{r.badge}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConciergeVisual() {
  const t = useT();
  return (
    <div style={{background:'linear-gradient(180deg, #eef2f9, #f6f8fc)',padding:24}}>
      <div className="phone">
        <div className="phone__head">
          <span className="av">T</span>
          <div><div className="name">Triplanio</div><div className="sub">{t('phone.via')}</div></div>
          <Icon name="telegram" size={16} stroke="none" fill="#2167e2" style={{marginLeft:'auto'}}/>
        </div>
        <div className="phone__body">
          <div className="phone__time">{t('phone.today')}</div>
          <div className="bubble bubble--ai">{t('phone.b1')}</div>
          <div className="bubble bubble--user" style={{alignSelf:'flex-end'}}>{t('phone.u1')}</div>
          <div className="bubble bubble--ai">{t('phone.b2')}</div>
          <div className="bubble bubble--user" style={{alignSelf:'flex-end'}}>{t('phone.u2')}</div>
          <div className="bubble bubble--ai">{t('phone.b3')}</div>
        </div>
      </div>
    </div>
  );
}

function BudgetVisual() {
  const t = useT();
  const rows = [
    {k:'mini.hotels',pct:42,amt:'€2,025',ccy:'$2,190',color:'#2167e2'},
    {k:'mini.flights',pct:28,amt:'€1,350',ccy:'$1,460',color:'#5b8fff'},
    {k:'mini.transfers',pct:9,amt:'€434',ccy:'$469',color:'#9bb6ff'},
    {k:'mini.activities',pct:13,amt:'€627',ccy:'$678',color:'#c9603a'},
    {k:'mini.food_misc',pct:8,amt:'€384',ccy:'$415',color:'#1f8a5b'},
  ];
  return (
    <div className="budget">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <span style={{fontSize:12,color:'var(--muted)',fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{t('mini.total')}</span>
        <span style={{fontSize:11.5,color:'var(--muted)'}}>{t('mini.home_ccy')}</span>
      </div>
      <div className="budget__total"><span className="big">€4,820</span><span className="delta">{t('mini.under_plan')}</span></div>
      <div className="budget__bar">{rows.map(r => <i key={r.k} style={{width:`${r.pct}%`,background:r.color}}/>)}</div>
      <div className="budget__rows" style={{marginTop:8}}>
        {rows.map(r => <div className="budget__row" key={r.k}><span className="sw" style={{background:r.color}}/><span>{t(r.k)}</span><span className="amt">{r.amt}</span><span className="ccy">{r.ccy}</span></div>)}
      </div>
    </div>
  );
}

function DeepDive({ reverse, eyebrowKey, titleKey, bodyKey, highlightKeys, children }) {
  const t = useT();
  return (
    <div className={`deep ${reverse?'deep--reverse':''} reveal`}>
      <div className="deep__copy">
        <span className="tag-eyebrow"><span className="dot"/>{t(eyebrowKey)}</span>
        <h3>{t(titleKey)}</h3>
        <p>{t(bodyKey)}</p>
        <ul className="deep__highlights">
          {highlightKeys.map(k => (
            <li key={k}><span className="check"><Icon name="check" size={12} strokeWidth={2.4}/></span><span>{t(k)}</span></li>
          ))}
        </ul>
      </div>
      <div className="deep__visual">{children}</div>
    </div>
  );
}

function DeepDives() {
  const t = useT();
  return (
    <section className="section section--wash">
      <div className="container">
        <div className="section__head section__head--left reveal" style={{marginBottom:16}}>
          <span className="eyebrow">{t('dd.eyebrow')}</span>
          <h2 style={{maxWidth:'18ch'}}>{t('dd.h2')}</h2>
        </div>
        <DeepDive eyebrowKey="dd.threeviews.eyebrow" titleKey="dd.threeviews.title" bodyKey="dd.threeviews.body" highlightKeys={['dd.threeviews.h1','dd.threeviews.h2','dd.threeviews.h3']}><ThreeViewsVisual/></DeepDive>
        <DeepDive reverse eyebrowKey="dd.planner.eyebrow" titleKey="dd.planner.title" bodyKey="dd.planner.body" highlightKeys={['dd.planner.h1','dd.planner.h2','dd.planner.h3']}><PlannerVisual/></DeepDive>
        <DeepDive eyebrowKey="dd.concierge.eyebrow" titleKey="dd.concierge.title" bodyKey="dd.concierge.body" highlightKeys={['dd.concierge.h1','dd.concierge.h2','dd.concierge.h3']}><ConciergeVisual/></DeepDive>
        <DeepDive reverse eyebrowKey="dd.budget.eyebrow" titleKey="dd.budget.title" bodyKey="dd.budget.body" highlightKeys={['dd.budget.h1','dd.budget.h2','dd.budget.h3']}><BudgetVisual/></DeepDive>
      </div>
    </section>
  );
}

/* ── Trust ── */
function Trust() {
  const t = useT();
  const items = [{icon:'globe',key:'trust.languages'},{icon:'devices',key:'trust.devices'},{icon:'lock',key:'trust.privacy'},{icon:'gift',key:'trust.free'}];
  return (
    <section className="section section--tight">
      <div className="container">
        <div className="trust reveal" style={{border:'1px solid var(--line)',borderRadius:16}}>
          {items.map(it => (
            <div className="trust__item" key={it.key}>
              <span className="icon"><Icon name={it.icon} size={18}/></span><span>{t(it.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ── */
const FAQ_KEYS = ['faq.q1','faq.q2','faq.q3','faq.q4','faq.q5','faq.q6','faq.q7'].map((q,i) => ({q,a:`faq.a${i+1}`}));

function FAQ() {
  const t = useT();
  const [open, setOpen] = useState(null);
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="faq">
          <div className="faq__intro reveal">
            <span className="eyebrow">{t('faq.eyebrow')}</span>
            <h2>{t('faq.h2')}</h2>
            <p>{t('faq.lede')}</p>
          </div>
          <div className="faq__list reveal">
            {FAQ_KEYS.map((f,i) => {
              const isOpen = open === i;
              return (
                <div className={`faq__item ${isOpen?'is-open':''}`} key={f.q}>
                  <button className="faq__q" aria-expanded={isOpen} onClick={() => setOpen(isOpen?null:i)}>
                    <span>{t(f.q)}</span>
                    <span className="plus"><Icon name="plus" size={16} strokeWidth={2.2}/></span>
                  </button>
                  <div className="faq__a"><div className="faq__a-inner">{t(f.a)}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ── */
function FinalCTA() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return (
    <section className="banner">
      <div className="reveal" style={{position:'relative',zIndex:1}}>
        <h2>{t('finalcta.h2')}</h2>
        <p>{t('finalcta.lede')}</p>
        <button className="btn btn--white btn--lg" style={{marginTop:32}} onClick={() => nav(ctaTarget)}>
          {t('finalcta.cta')} <Icon name="arrowRight" size={16} className="chev"/>
        </button>
      </div>
    </section>
  );
}

/* ── Footer ── */
function LandingFooter({ lang, setLang }) {
  const t = useT();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__top">
          <div className="footer__brand">
            <a href="#top" className="brand" aria-label="Triplanio — home" style={{color:'var(--ink)'}}>
              <span className="brand__mark"><TriplanioMark size={26}/></span>
              <span>Triplanio</span>
            </a>
            <p className="tagline">{t('footer.tagline')}</p>
          </div>
          <div className="footer__cols">
            <div className="footer__col">
              <h4>{t('footer.product')}</h4>
              <a href="#features">{t('footer.features')}</a>
              <a href="#how">{t('footer.how')}</a>
              <a href="#faq">{t('footer.faq')}</a>
            </div>
            <div className="footer__col">
              <h4>{t('footer.company')}</h4>
              <a href="#">{t('footer.about')}</a>
              <a href="#">{t('footer.contact')}</a>
            </div>
            <div className="footer__col">
              <h4>{t('footer.legal')}</h4>
              <a href="/privacy">{t('footer.privacy')}</a>
              <a href="/terms">{t('footer.terms')}</a>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <LangDropdown value={lang} onChange={setLang} direction="up"/>
          </div>
        </div>
        <div className="footer__bottom">
          <span>{t('footer.copy')}</span>
          <div className="footer__social" aria-label="Social">
            <a href="#" aria-label="Twitter / X"><Icon name="twitter" size={16}/></a>
            <a href="#" aria-label="Instagram"><Icon name="instagram" size={16}/></a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ── Scroll reveal ── */
function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timelineLive = false;
    const t0 = document.timeline?.currentTime ?? 0;
    requestAnimationFrame(() => {
      const t1 = document.timeline?.currentTime ?? 0;
      timelineLive = t1 > t0;
      if (!timelineLive) return;
      document.documentElement.classList.add('reveal--ready');
      const reveal = () => {
        const vh = window.innerHeight;
        document.querySelectorAll('.reveal:not(.is-in)').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.top < vh * 0.9 && r.bottom > 0) el.classList.add('is-in');
        });
      };
      let raf = 0;
      const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; reveal(); }); };
      reveal();
      window.addEventListener('scroll', onScroll, { passive:true });
      window.addEventListener('resize', onScroll);
      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        document.documentElement.classList.remove('reveal--ready');
      };
    });
  }, []);
}

/* ── Main LandingPage ── */
export default function LandingPage() {
  const [lang, setLangRaw] = useState(detectLang);
  const [cssReady, setCssReady] = useState(false);

  const setLang = (next) => {
    setLangRaw(next);
    try { localStorage.setItem('triplanio.lang', next); } catch (_) {}
    const map = { EN:'en', RU:'ru', ES:'es' };
    document.documentElement.setAttribute('lang', map[next] || 'en');
  };

  /* Dynamically load landing CSS on mount, remove on unmount */
  useEffect(() => {
    /* If already loaded (e.g. hot reload), mark ready immediately */
    const existing = document.getElementById('landing-css');
    if (existing) {
      setCssReady(true);
    } else {
      const link = document.createElement('link');
      link.id = 'landing-css';
      link.rel = 'stylesheet';
      link.href = '/landing.css';
      link.addEventListener('load', () => setCssReady(true));
      /* Fallback: if load event fires before listener (cached) */
      if (link.sheet) setCssReady(true);
      document.head.appendChild(link);
    }

    /* Set landing theme attrs */
    document.documentElement.setAttribute('data-palette', 'atlantic');
    document.documentElement.setAttribute('data-type', 'modern');
    document.documentElement.setAttribute('data-density', 'standard');

    return () => {
      const el = document.getElementById('landing-css');
      if (el) el.parentNode.removeChild(el);
      document.documentElement.removeAttribute('data-palette');
      document.documentElement.removeAttribute('data-type');
      document.documentElement.removeAttribute('data-density');
      document.documentElement.classList.remove('reveal--ready');
      setCssReady(false);
    };
  }, []);

  useScrollReveal();

  /* Don't render until landing CSS is loaded — prevents flash of unstyled content */
  if (!cssReady) return null;

  return (
    <LangCtx.Provider value={lang}>
      <LandingHeader lang={lang} setLang={setLang} />
      <main>
        <Hero />
        <Problem />
        <Features />
        <HowItWorks />
        <DeepDives />
        <Trust />
        <FAQ />
        <FinalCTA />
      </main>
      <LandingFooter lang={lang} setLang={setLang} />
    </LangCtx.Provider>
  );
}

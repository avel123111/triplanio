import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AI trip planner.
 *
 * Body:
 *   {
 *     prompt: string,                  // user wishes (required)
 *     currentDraft?: TripDraft | null, // existing draft for refinement
 *     history?: Array<{ role: 'user'|'ai', text: string }>, // full prior conversation
 *     language?: 'ru' | 'en' | 'es'    // response language (default 'ru')
 *   }
 *
 * Returns:
 *   {
 *     draft: {
 *       title: string,
 *       description: string,
 *       cities: [
 *         {
 *           city_name: string,
 *           country: string,
 *           country_code: string,
 *           start_date: 'YYYY-MM-DD',
 *           end_date: 'YYYY-MM-DD',
 *           kind?: 'start' | 'transit' | 'end',
 *           activities?: [
 *             { title: string, date: 'YYYY-MM-DD', start_time?: 'HH:MM', end_time?: 'HH:MM', notes?: string }
 *           ]
 *         }
 *       ]
 *     },
 *     ai_comment: string
 *   }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = (body?.prompt || '').toString().trim();
    const currentDraft = body?.currentDraft || null;
    const history = Array.isArray(body?.history) ? body.history : [];
    const language = body?.language || 'ru';

    if (!prompt) {
      return Response.json({ error: 'prompt is required' }, { status: 400 });
    }

    const langInstr = {
      ru: 'Все тексты (title, description, comment, activity titles, notes) — на русском языке.',
      en: 'All texts (title, description, comment, activity titles, notes) must be in English.',
      es: 'Todos los textos (title, description, comment, activity titles, notes) deben estar en español.',
    }[language] || 'Use the user\'s language.';

    const today = new Date().toISOString().slice(0, 10);

    // Build conversation history block (so the model retains context across refinements).
    // Block headers are in English — the model handles all three target languages
    // (ru/en/es) equally well with English structural markers.
    const historyBlock = history.length
      ? '\n=== CONVERSATION HISTORY (oldest → newest) ===\n' +
        history.map((h, i) => `${i + 1}. [${h.role === 'user' ? 'USER' : 'AI'}] ${h.text}`).join('\n') +
        '\n=== END HISTORY ===\n'
      : '';

    const draftBlock = currentDraft
      ? '\n=== CURRENT DRAFT (modify per the new request, PRESERVING what does not conflict) ===\n' +
        JSON.stringify(currentDraft, null, 2) +
        '\n=== END DRAFT ===\n'
      : '';

    const systemPreamble = `Ты — опытный планировщик путешествий. На основе пожеланий пользователя собери черновик маршрута.

ВАЖНО:
- ОБЯЗАТЕЛЬНО заполни: title, description, cities (с city_name, country, country_code, start_date, end_date).
- title — КОРОТКИЙ (максимум 3-4 слова, идеально 1-2). Например: "Испания осенью", "Уикенд в Риме", "Тур по Японии". НЕ пиши длинные фразы, даты или перечисления городов в названии.
- activities — добавляй ТОЛЬКО если пользователь явно попросил (например, "составь программу", "что посмотреть", "включи активности"). Иначе оставь пустым массивом.
- Для КАЖДОЙ активности ОБЯЗАТЕЛЬНО указывай: title (что), date (когда), location_name (название места — например "Эйфелева башня"), location_address (полный адрес — например "Champ de Mars, 5 Av. Anatole France, 75007 Paris, France"). Адрес должен быть в формате, пригодном для Google Maps.
- Транспорт/трансферы НЕ планируй — это сделает пользователь сам.
- Даты в формате YYYY-MM-DD. Сегодня: ${today}. Если пользователь не указал даты — выбери разумные ближайшие будущие даты.
- country_code — ISO 3166-1 alpha-2 (например, "PT", "ES", "FR").
- end_date города = день отъезда (последняя ночь — это end_date - 1).
- Города идут последовательно: end_date одного = start_date следующего.
- city_name пиши коротко (только город, без страны).

ТОЧКИ СТАРТА И ОКОНЧАНИЯ (ВАЖНО):
- Если пользователь явно упомянул откуда стартует трип (например, "лечу из Москвы", "стартую из Барселоны", "начинаю из Лиссабона") — добавь ПЕРВЫМ городом в cities этот город старта с kind="start". Для него start_date = end_date (это один день вылета/отбытия), активности не добавляй.
- Если пользователь упомянул конечную точку возвращения (например, "вернусь в Москву", "заканчиваю в Дубае") — добавь ПОСЛЕДНИМ городом этот город с kind="end". Для него start_date = end_date.
- Если пользователь явно НЕ упоминает старт/конец — НЕ добавляй start/end города, только transit.
- Все остальные города — kind="transit" (или не указывай kind вообще — по умолчанию transit).

ai_comment:
- 2-4 предложения: какой маршрут собрал и почему, что учёл из запроса.
- Если уточняешь существующий черновик — опиши КАК ИМЕННО его поменял (что добавил/убрал/изменил).
- Учитывай ВСЕ предыдущие пожелания пользователя из истории диалога, а не только последний запрос.

- ${langInstr}
${historyBlock}${draftBlock}
Новый запрос пользователя: ${prompt}`;

    const schema = {
      type: 'object',
      properties: {
        draft: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            cities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  city_name: { type: 'string' },
                  country: { type: 'string' },
                  country_code: { type: 'string' },
                  start_date: { type: 'string' },
                  end_date: { type: 'string' },
                  kind: { type: 'string', enum: ['start', 'transit', 'end'] },
                  activities: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        date: { type: 'string' },
                        start_time: { type: 'string' },
                        end_time: { type: 'string' },
                        location_name: { type: 'string', description: 'POI name, e.g. "Eiffel Tower"' },
                        location_address: { type: 'string', description: 'Full street address for Google Maps' },
                        notes: { type: 'string' },
                      },
                      required: ['title', 'date'],
                    },
                  },
                },
                required: ['city_name', 'country', 'country_code', 'start_date', 'end_date'],
              },
            },
          },
          required: ['title', 'description', 'cities'],
        },
        ai_comment: { type: 'string' },
      },
      required: ['draft', 'ai_comment'],
    };

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: systemPreamble,
      response_json_schema: schema,
      model: 'gemini_3_flash',
      add_context_from_internet: true,
    });

    return Response.json(result);
  } catch (error) {
    console.error('planTripWithAi error', error);
    return Response.json({ error: error.message || String(error) }, { status: 500 });
  }
});
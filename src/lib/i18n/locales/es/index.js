import common from './common';
import event from './event';
import nav from './nav';
import trips from './trips';
import trip from './trip';
import visit from './visit';
import hotel from './hotel';
import activity from './activity';
import transfer from './transfer';
import member from './member';
import notif from './notif';
import view from './view';
import settings from './settings';
import auth from './auth';
import calendar from './calendar';
import doc from './doc';
import service from './service';
import sub from './sub';
import pub from './public';
import booking from './booking';
import telegram from './telegram';
import budget from './budget';
import chat from './chat';
import admin from './admin';
import trip_menu from './trip_menu';
import overview from './overview';
import ai_plan from './ai_plan';
import planner from './planner';
import account from './account';
import tse from './tse';
import sys from './sys';
import tl from './tl';
import validation from './validation';
import confirm from './confirm';
import landing from './landing';
import stats from './stats';
import units from './units';

export default {
  ...common, ...event, ...nav, ...trips, ...trip, ...visit, ...hotel, ...activity,
  ...transfer, ...member, ...notif, ...view, ...settings, ...auth, ...calendar,
  ...doc, ...service, ...sub, ...pub, ...booking, ...telegram, ...budget, ...chat,
  ...admin, ...trip_menu, ...overview, ...ai_plan, ...planner, ...account, ...tse, ...sys, ...tl,
  ...validation, ...confirm, ...landing, ...stats, ...units,
};
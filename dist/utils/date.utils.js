"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStartOfMonthIST = exports.getStartOfWeekIST = exports.getStartOfYesterdayIST = exports.getStartOfTodayIST = exports.getISTDateString = void 0;
const getISTDateString = (date = new Date()) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
};
exports.getISTDateString = getISTDateString;
const getStartOfTodayIST = (date = new Date()) => {
    const istDateStr = (0, exports.getISTDateString)(date);
    const startOfTodayUTC = new Date(`${istDateStr}T00:00:00.000Z`);
    // Asia/Kolkata is UTC + 5:30. Subtract 330 minutes to get the UTC time representing midnight IST.
    startOfTodayUTC.setMinutes(startOfTodayUTC.getMinutes() - 330);
    return startOfTodayUTC;
};
exports.getStartOfTodayIST = getStartOfTodayIST;
const getStartOfYesterdayIST = (date = new Date()) => {
    const todayIST = (0, exports.getStartOfTodayIST)(date);
    todayIST.setDate(todayIST.getDate() - 1);
    return todayIST;
};
exports.getStartOfYesterdayIST = getStartOfYesterdayIST;
const getStartOfWeekIST = (date = new Date()) => {
    const todayIST = (0, exports.getStartOfTodayIST)(date);
    const istDayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(date);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const istDayOfWeek = days.indexOf(istDayStr);
    todayIST.setDate(todayIST.getDate() - istDayOfWeek);
    return todayIST;
};
exports.getStartOfWeekIST = getStartOfWeekIST;
const getStartOfMonthIST = (date = new Date()) => {
    const istDateStr = (0, exports.getISTDateString)(date);
    const [year, month] = istDateStr.split('-');
    const startOfMonthUTC = new Date(`${year}-${month}-01T00:00:00.000Z`);
    startOfMonthUTC.setMinutes(startOfMonthUTC.getMinutes() - 330);
    return startOfMonthUTC;
};
exports.getStartOfMonthIST = getStartOfMonthIST;

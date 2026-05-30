export const getISTDateString = (date: Date = new Date()): string => {
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

export const getStartOfTodayIST = (date: Date = new Date()): Date => {
  const istDateStr = getISTDateString(date);
  const startOfTodayUTC = new Date(`${istDateStr}T00:00:00.000Z`);
  // Asia/Kolkata is UTC + 5:30. Subtract 330 minutes to get the UTC time representing midnight IST.
  startOfTodayUTC.setMinutes(startOfTodayUTC.getMinutes() - 330);
  return startOfTodayUTC;
};

export const getStartOfYesterdayIST = (date: Date = new Date()): Date => {
  const todayIST = getStartOfTodayIST(date);
  todayIST.setDate(todayIST.getDate() - 1);
  return todayIST;
};

export const getStartOfWeekIST = (date: Date = new Date()): Date => {
  const todayIST = getStartOfTodayIST(date);
  const istDayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const istDayOfWeek = days.indexOf(istDayStr);
  todayIST.setDate(todayIST.getDate() - istDayOfWeek);
  return todayIST;
};

export const getStartOfMonthIST = (date: Date = new Date()): Date => {
  const istDateStr = getISTDateString(date);
  const [year, month] = istDateStr.split('-');
  const startOfMonthUTC = new Date(`${year}-${month}-01T00:00:00.000Z`);
  startOfMonthUTC.setMinutes(startOfMonthUTC.getMinutes() - 330);
  return startOfMonthUTC;
};

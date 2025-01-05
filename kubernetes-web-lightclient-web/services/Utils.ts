export function UtilsRelativeTime(date: string) {
  const delta = Math.round((new Date().getTime() - new Date(date).getTime()) / 1000);
  const minute = 60,
    hour = minute * 60,
    day = hour * 24,
    week = day * 7,
    month = day * 30,
    year = day * 365;
  if (delta < 60) {
    return "just now";
  } else if (delta < hour) {
    return Math.floor(delta / minute) + " min";
  } else if (delta < 2 * hour) {
    return "1 hour";
  } else if (delta < day) {
    return Math.floor(delta / hour) + " h";
  } else if (delta < 2 * day) {
    return "1 day";
  } else if (delta < week) {
    return Math.floor(delta / day) + " days";
  } else if (delta < 2 * week) {
    return "1 week";
  } else if (delta < month) {
    return Math.floor(delta / week) + " weeks";
  } else if (delta < 2 * month) {
    return "1 month";
  } else if (delta < year) {
    return Math.floor(delta / month) + " months";
  } else if (delta < 2 * year) {
    return "1 year";
  } else {
    return Math.floor(delta / year) + " years";
  }
}

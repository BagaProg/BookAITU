let notification;
export function playBookingSound() {
  try {
    notification ??= new Audio('/audio/notify.mp3');
    notification.currentTime = 0;
    const playing = notification.play();
    playing?.catch(() => {});
  } catch { /* Audio must never interrupt a booking action. */ }
}

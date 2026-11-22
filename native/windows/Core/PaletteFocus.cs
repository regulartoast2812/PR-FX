using System;

namespace PrFxShortcutListener
{
    // When the Ctrl+Space palette loses the front: keep it, take the front back, or close (2026-11-22).
    //
    // Why this is its own rule with its own checks: the palette closing the moment it opened has broken every palette
    // command three times (the banner made TopMost took the front; Alt+Tab's switcher hid Premiere; Windows reported
    // Premiere in front while the palette attached to its input to take the front). The user: "have a safeguard so that
    // won't happen again… it's literally break 50% of abilities". The rule is checked in tools/check-windows-bridge (the
    // decisions) and tools/check-windows-listener (the real palette and banner against a window that grabs the front back,
    // as Premiere does), and build-windows.cmd refuses to build the listener when either fails.
    internal enum PaletteFocusAction { Keep, CheckAgain, TakeBack, Close }

    internal sealed class PaletteFocus
    {
        // A lost front is looked at again after this long, so a blip while Windows hands the front over never closes it.
        public const int RecheckMs = 120;
        // Premiere taking the front back this soon after opening is Premiere reacting to the press, not the user leaving.
        public const int GraceMs = 600;
        public const int TakeBacks = 2;
        // If it still closes as it opens (a new Windows or Premiere behaviour), the next opens wait longer.
        public const int WideGraceMs = 1500;
        public const int WideTakeBacks = 4;
        // A close this soon after opening counts as "closed as it opened".
        public const int QuickCloseMs = 1000;

        public bool Opening { get; private set; }
        public int TakenBack { get; private set; }
        public int QuickCloses { get; private set; }
        public int QuickClosesInARow { get; private set; }
        private DateTime openedAt = DateTime.MinValue, lastTakeBack = DateTime.MinValue;

        public bool Wide => QuickClosesInARow >= 2;
        public int Grace => Wide ? WideGraceMs : GraceMs;
        public int MaxTakeBacks => Wide ? WideTakeBacks : TakeBacks;

        public void BeginOpen() { Opening = true; TakenBack = 0; }
        public void EndOpen(DateTime now) { Opening = false; openedAt = now; lastTakeBack = DateTime.MinValue; }

        // Windows says the palette lost the front.
        public PaletteFocusAction OnDeactivate(bool visible) => !visible || Opening ? PaletteFocusAction.Keep : PaletteFocusAction.CheckAgain;

        // RecheckMs later: who has the front now?
        public PaletteFocusAction OnRecheck(bool visible, bool oursInFront, bool premiereInFront, DateTime now)
        {
            if (!visible || oursInFront) return PaletteFocusAction.Keep;
            // The grace runs from opening or from the last take-back, so a slow second grab still counts as Premiere's.
            var since = (now - (lastTakeBack > openedAt ? lastTakeBack : openedAt)).TotalMilliseconds;
            if (premiereInFront && TakenBack < MaxTakeBacks && since < Grace) { TakenBack++; lastTakeBack = now; return PaletteFocusAction.TakeBack; }
            since = (now - openedAt).TotalMilliseconds;
            if (since < QuickCloseMs) { QuickCloses++; QuickClosesInARow++; }
            else QuickClosesInARow = 0;
            return PaletteFocusAction.Close;
        }

        // Closed by the user (Esc, a command run): the palette worked.
        public void OnClosedByUser() => QuickClosesInARow = 0;
    }
}

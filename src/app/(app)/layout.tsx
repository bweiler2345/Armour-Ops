import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";

// Shell for signed-in screens. Auth is checked in each page through the DAL,
// not here: layouts do not re-run on client navigation.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-xl flex-col md:border-x md:border-charcoal-800">
      <AppHeader />
      <main className="flex-1 px-4 pt-5 pb-36 sm:px-6">{children}</main>
      <BottomNav />
    </div>
  );
}

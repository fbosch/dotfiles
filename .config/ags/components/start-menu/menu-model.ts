export interface MenuItem {
	id: string;
	label: string;
	icon: string;
	variant?: "default" | "warning" | "danger" | "purple";
	prefetchOnIntent?: boolean;
}

export const defaultMenuItems: MenuItem[] = [
	{
		id: "about-this-pc",
		label: "About This PC",
		icon: "\uE946",
		prefetchOnIntent: true,
	},
	{ id: "system-settings", label: "System Settings", icon: "\uE713" },
	{ id: "system-updates", label: "System Updates", icon: "\uE895" },
	{ id: "divider-profile", label: "", icon: "" },
	{ id: "profile-controls", label: "", icon: "" },
	{ id: "divider-locations", label: "", icon: "" },
	{ id: "applications", label: "Applications", icon: "\uE71D" },
	{ id: "documents", label: "Documents", icon: "\uE8A5" },
	{ id: "pictures", label: "Pictures", icon: "\uE91B" },
	{ id: "downloads", label: "Downloads", icon: "\uE896" },
	{ id: "recent-items", label: "Recent Items", icon: "\uE81C" },
	{ id: "divider-force-quit", label: "", icon: "" },
	{ id: "force-quit", label: "Force Quit", icon: "\uE7BA" },
	{ id: "divider-session", label: "", icon: "" },
	{ id: "suspend", label: "Suspend", icon: "\uE708", variant: "purple" },
	{ id: "restart", label: "Restart", icon: "\uE777", variant: "warning" },
	{ id: "shutdown", label: "Shutdown", icon: "\uE7E8", variant: "danger" },
	{ id: "divider-account", label: "", icon: "" },
	{ id: "lock-screen", label: "Lock Screen", icon: "\uE72E" },
	{ id: "sign-out", label: "Log out", icon: "\uE8AB", variant: "warning" },
];

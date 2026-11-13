import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  Target,
  Unplug,
  Users,
} from "lucide-react";

export const primaryNavigation = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/leads", label: "Leads", icon: Users },
  { path: "/work", label: "Follow-ups", icon: CalendarDays },
  {
    path: "/marketing",
    label: "Marketing",
    icon: Target,
    permission: "marketing.read",
  },
  { path: "/flow", label: "Reports", icon: BarChart3 },
];
export const setupNavigation = [
  {
    path: "/intake",
    label: "Enquiry forms",
    text: "Manage the courses and forms that collect enquiries.",
    icon: Target,
    permission: "settings.write",
  },
  {
    path: "/operations",
    label: "Integrations",
    text: "Configure providers, imports and approved actions.",
    icon: Unplug,
    permission: "connections.write",
  },
  {
    path: "/account-settings",
    label: "Team & account",
    text: "Manage members, access, account security and billing.",
    icon: ShieldCheck,
    permission: "settings.write",
  },
  {
    path: "/settings",
    label: "Workspace preferences",
    text: "Set your reporting preferences, response target and privacy settings.",
    icon: Settings2,
  },
  {
    path: "/connections",
    label: "Provider catalog",
    text: "Explore supported advertising, CRM, payment and AI providers.",
    icon: Unplug,
  },
];

export type Role = 'Employee' | 'Manager' | 'HrAdmin' | 'SuperAdmin'
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  designation: string | null
  department: string | null
  avatarUrl: string | null
  mustChangePassword: boolean
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: User
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface EmployeeListItem {
  id: number
  employeeCode: string
  name: string
  email: string
  role: Role
  designation: string | null
  departmentId: number | null
  department: string | null
  managerId: number | null
  manager: string | null
  employmentType: string
  location: string | null
  joinDate: string
  isActive: boolean
  avatarUrl: string | null
}

export interface DirectoryItem {
  id: number
  name: string
  email: string
  phone: string | null
  designation: string | null
  department: string | null
  manager: string | null
  location: string | null
  avatarUrl: string | null
}

export interface EmployeeDetail {
  id: number
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  role: Role
  isActive: boolean
  departmentId: number | null
  department: string | null
  managerId: number | null
  manager: string | null
  designation: string | null
  employmentType: string
  location: string | null
  joinDate: string
  dateOfBirth: string | null
  gender: string | null
  phone: string | null
  localAddress: string | null
  permanentAddress: string | null
  fatherName: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelation: string | null
  bankAccountHolder: string | null
  bankName: string | null
  bankAccountNumber: string | null
  bankIfsc: string | null
  taxId: string | null
  avatarUrl: string | null
  profileCompleteness: number
  sensitiveVisible: boolean
}

export interface Department {
  id: number
  name: string
  description: string | null
  isActive: boolean
  employeeCount: number
}

export interface LeaveType {
  id: number
  name: string
  code: string
  color: string
  defaultAnnualDays: number
  tracksBalance: boolean
  allowHalfDay: boolean
  isPaid: boolean
  isActive: boolean
}

export interface Holiday {
  id: number
  name: string
  date: string
  kind: 'Holiday' | 'OfficeOff'
}

export interface Announcement {
  id: number
  title: string
  body: string
  isPinned: boolean
  isPublished: boolean
  publishedAt: string
  createdBy: string | null
}

export interface Balance {
  leaveTypeId: number
  name: string
  code: string
  color: string
  tracksBalance: boolean
  total: number
  used: number
  pending: number
  available: number
}

export interface LeaveRow {
  id: number
  employeeId: number
  employeeName: string
  department: string | null
  leaveTypeId: number
  leaveType: string
  leaveTypeCode: string
  color: string
  startDate: string
  endDate: string
  isHalfDay: boolean
  days: number
  reason: string
  status: LeaveStatus
  appliedAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionComment: string | null
  ageDays: number
}

export interface LeaveEvent {
  kind: string
  actor: string | null
  comment: string | null
  at: string
}

export interface LeaveConflict {
  employeeId: number
  employeeName: string
  startDate: string
  endDate: string
  status: string
}

export interface LeaveDetail {
  leave: LeaveRow
  events: LeaveEvent[]
  conflicts: LeaveConflict[]
  balance: Balance | null
}

export interface LeaveSlot {
  leaveTypeId: number
  startDate: string
  endDate: string | null
  isHalfDay: boolean
  reason: string | null
}

export interface SlotCheck {
  index: number
  leaveTypeId: number
  startDate: string
  endDate: string
  isHalfDay: boolean
  days: number
  availableBefore: number | null
  availableAfter: number | null
  errors: string[]
  warnings: string[]
}

export interface CalendarEvent {
  date: string
  type: 'holiday' | 'officeoff' | 'leave' | 'birthday' | 'anniversary'
  title: string
  employeeId: number | null
  status: string | null
  color: string | null
}

export interface AppNotification {
  id: number
  title: string
  message: string
  link: string | null
  isRead: boolean
  createdAt: string
}

export interface UpcomingEvent {
  date: string
  type: 'birthday' | 'anniversary'
  name: string
  employeeId: number
  years: number | null
  avatarUrl: string | null
}

export interface EmployeeDashboard {
  user: User
  manager: string | null
  joinDate: string
  balances: Balance[]
  pendingCount: number
  nextLeave: LeaveRow | null
  today: { date: string; status: 'Holiday' | 'Weekend' | 'OnLeave' | 'Working'; detail: string }
  holidays: Holiday[]
  events: UpcomingEvent[]
  announcements: Announcement[]
  unreadNotifications: number
  profileCompleteness: number
  profileTodo: string[]
}

export interface TeamDashboard {
  scope: 'team' | 'organization'
  headcount: number
  newJoiners: number
  exits: number
  availableToday: number
  onLeaveToday: { employeeId: number; name: string; type: string; isHalfDay: boolean; until: string; avatarUrl: string | null }[]
  pending: { count: number; overdue: number; oldestAt: string | null; items: LeaveRow[] }
  trend: { label: string; days: number }[]
  exceptions: { kind: 'warning' | 'info' | 'error'; text: string; link: string }[]
  holidays: Holiday[]
  events: UpcomingEvent[]
}

export interface LeaveReport {
  summary: {
    totalApplications: number
    totalDays: number
    byType: { name: string; count: number; days: number }[]
    byDepartment: { name: string; count: number; days: number }[]
    byMonth: { label: string; days: number; count: number }[]
    byStatus: { status: string; count: number }[]
    topEmployees: { name: string; days: number }[]
  }
  rows: Paged<LeaveRow>
}

export interface AuditItem {
  id: number
  actor: string | null
  action: string
  entityType: string
  entityId: string | null
  beforeJson: string | null
  afterJson: string | null
  ipAddress: string | null
  at: string
}

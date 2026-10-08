export type Choice = { value: string; label: string };

export type Stage = { code: string; name: string; order: number; scope: "ASSET" | "FARMER"; asset_types: string[]; is_active: boolean };

export type Meta = {
  roles: Choice[];
  project_types: Choice[];
  voltage_levels: Choice[];
  project_statuses: Choice[];
  farmer_statuses: Choice[];
  kyc_statuses: Choice[];
  relations: Choice[];
  ownership_types: Choice[];
  land_types: Choice[];
  asset_types: Choice[];
  agreement_types: Choice[];
  agreement_statuses: Choice[];
  crop_seasons: Choice[];
  crop_stages: Choice[];
  compensation_categories: Choice[];
  compensation_statuses: Choice[];
  payment_modes: Choice[];
  document_categories: Choice[];
  stages: Stage[];
  settings: Record<string, any>;
};

type Perm = { read: boolean; write: boolean; delete: boolean };
export type Me = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  role_label: string;
  display_name: string;
  company_name: string | null;
  permissions: Record<string, Perm & Record<string, boolean>> & { stages: Record<string, boolean> };
};

export type ProjectBrief = { id: string; code: string; name: string };

export type Project = ProjectBrief & {
  developer: string;
  project_type: string;
  voltage_level: string;
  corridor: string;
  status: string;
  start_date: string | null;
  description: string;
  village: string;
  hobli: string;
  taluk: string;
  district: string;
  state: string;
  asset_count?: number;
  farmer_count?: number;
  route_geojson: any;
};

export type Farmer = {
  id: string;
  farmer_code: string | null;
  name: string;
  relation_type: string;
  relation_name: string;
  mobile: string;
  alt_mobile: string;
  address: string;
  village: string;
  hobli: string;
  taluk: string;
  district: string;
  state: string;
  status: string;
  aadhaar_last4: string;
  kyc_status: string;
  kyc_collected_on: string | null;
  kyc_verified_on: string | null;
  kyc_done: boolean;
  bank_account_holder?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_account_masked: string;
  can_view_bank: boolean;
  projects: ProjectBrief[];
  land_count: number;
  kyc_document_count: number;
  remarks: string;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
};

export type Owner = { ownership_id: string; farmer_id: string; farmer_code: string; name: string; is_primary_payee: boolean; kyc_status: string };

export type Land = {
  id: string;
  survey_number: string;
  hissa: string;
  survey_label: string;
  village: string;
  hobli: string;
  taluk: string;
  district: string;
  state: string;
  extent_acres: number;
  extent_guntas: number;
  total_acres: number;
  ownership_type: string;
  land_type: string;
  rtc_reference: string;
  mutation_details: string;
  latitude: number | null;
  longitude: number | null;
  boundary_geojson: any;
  projects: ProjectBrief[];
  owners: Owner[];
  asset_count: number;
  remarks: string;
};

export type StageProgress = {
  code: string;
  name: string;
  scope: string;
  completed: boolean;
  partial: boolean;
  detail: string;
  completed_on: string | null;
  source: string | null;
  milestone_id: string | null;
};

export type Progress = { stages: StageProgress[]; completed_count: number; total: number; percent: number; latest_completed: string | null };

export type Asset = {
  id: string;
  project: string;
  project_code: string;
  project_name: string;
  asset_type: string;
  asset_number: string;
  line_name: string;
  land_parcel: string | null;
  land_label: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  gps_captured_at: string | null;
  gps_warning: boolean;
  farmers: { id: string; farmer_code: string; name: string; kyc_status: string; mobile: string }[];
  progress: Progress;
  remarks: string;
  updated_at: string;
};

export type Agreement = {
  id: string;
  agreement_number: string;
  project: string;
  project_code: string;
  land_parcel: string | null;
  land_label: string | null;
  agreement_type: string;
  status: string;
  purpose: string;
  land_extent: string;
  agreement_date: string | null;
  period_months: number | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  compensation_rate: string;
  total_consideration: number | null;
  registration_details: string;
  stamp_duty: number | null;
  witness_details: string;
  remarks: string;
  farmer_list: { id: string; farmer_code: string; name: string }[];
  asset_list: { id: string; asset_number: string; asset_type: string }[];
  document_count: number;
};

export type Compensation = {
  id: string;
  project: string;
  project_code: string;
  asset: string | null;
  asset_number: string | null;
  land_parcel: string | null;
  land_label: string | null;
  payee: string;
  payee_code: string;
  payee_name: string;
  crop_assessment: string | null;
  category: string;
  description: string;
  quantity: number | null;
  unit: string;
  approved_amount: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: "UNPAID" | "PARTIAL" | "PAID";
  status: string;
  approved_on: string | null;
  approved_by_name: string | null;
  payment_count: number;
  remarks: string;
  created_by_name: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  compensation: string;
  compensation_category: string;
  project_code: string;
  payee_name: string;
  payee_code: string;
  paid_to: string | null;
  paid_to_name: string | null;
  asset_number: string | null;
  amount: number;
  payment_date: string;
  mode: string;
  reference_number: string;
  receipt_number: string;
  remarks: string;
  receipt_count: number;
  created_by_name: string | null;
};

export type CropAssessment = {
  id: string;
  project: string;
  project_code: string;
  farmer: string;
  farmer_code: string;
  farmer_name: string;
  land_parcel: string | null;
  land_label: string | null;
  asset: string | null;
  asset_number: string | null;
  season: string;
  crop_type: string;
  crop_area_acres: number | null;
  crop_stage: string;
  assessment_date: string | null;
  field_inspection_notes: string;
  revenue_assessment: number | null;
  company_assessment: number | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  compensation_summary: { approved: number; paid: number; balance: number } | null;
  photo_count: number;
};

export type Doc = {
  id: string;
  category: string;
  category_label: string;
  title: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  is_sensitive: boolean;
  captured_live: boolean;
  captured_at: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  download_url: string | null;
  can_view: boolean;
  created_at: string;
  created_by_name: string | null;
  notes: string;
};

export type User = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: string;
  role_label: string;
  is_active: boolean;
  projects: ProjectBrief[];
  display_name: string;
  last_login: string | null;
};

export type Paged<T> = { count: number; next: string | null; previous: string | null; results: T[] };

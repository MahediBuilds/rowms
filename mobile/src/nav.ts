import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStack = {
  Login: undefined;
  Main: undefined;
  Location: { id?: string };
  Farmer: { id?: string; landId?: string };
  Land: { id?: string; farmerId?: string };
  Crop: { id?: string; assetId?: string; farmerId?: string; landId?: string };
  Sync: undefined;
};

export type Tabs = {
  Home: undefined;
  Locations: undefined;
  Farmers: undefined;
  Lands: undefined;
  CropList: undefined;
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;

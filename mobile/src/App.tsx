import { ActivityIndicator, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { SessionProvider, useSession } from "./session";
import type { RootStack, Tabs } from "./nav";
import { C } from "./theme";
import { LoginScreen } from "./screens/Login";
import { HomeScreen } from "./screens/Home";
import { LocationScreen, LocationsScreen } from "./screens/Locations";
import { FarmerScreen, FarmersScreen } from "./screens/Farmers";
import { LandScreen, LandsScreen } from "./screens/Lands";
import { CropListScreen, CropScreen } from "./screens/Crop";
import { SyncScreen } from "./screens/Sync";

const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator<Tabs>();

const header = {
  headerStyle: { backgroundColor: C.ink },
  headerTintColor: "#fff",
  headerTitleStyle: { fontWeight: "700" as const },
};

const TAB_ICONS: Record<keyof Tabs, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ["home", "home-outline"],
  Locations: ["flash", "flash-outline"],
  Farmers: ["people", "people-outline"],
  Lands: ["map", "map-outline"],
  CropList: ["leaf", "leaf-outline"],
};

function MainTabs() {
  const { project } = useSession();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...header,
        tabBarActiveTintColor: C.field,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarIcon: ({ focused, color, size }) => <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "ROW Field", tabBarLabel: "Home" }} />
      <Tab.Screen name="Locations" component={LocationsScreen} options={{ title: "Poles", headerTitle: project ? `Poles & towers, ${project.code}` : "Poles & towers" }} />
      <Tab.Screen name="Farmers" component={FarmersScreen} options={{ title: "Farmers" }} />
      <Tab.Screen name="Lands" component={LandsScreen} options={{ title: "Land", headerTitle: "Land records" }} />
      <Tab.Screen name="CropList" component={CropListScreen} options={{ title: "Crop", headerTitle: "Crop assessments" }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, me } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.ink }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }
  return (
    <Stack.Navigator screenOptions={header}>
      {!me ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Location" component={LocationScreen} />
          <Stack.Screen name="Farmer" component={FarmerScreen} />
          <Stack.Screen name="Land" component={LandScreen} />
          <Stack.Screen name="Crop" component={CropScreen} />
          <Stack.Screen name="Sync" component={SyncScreen} options={{ title: "Sync & account" }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: C.paper, primary: C.field } }}>
          <StatusBar style="light" />
          <Root />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

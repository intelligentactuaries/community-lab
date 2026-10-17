// The glyph for each asset of the catalogue (Icons.tsx draws them).
import type { ComponentType } from 'react';
import { Ambulance, Ball, Banknote, Bag, Basket, Book, Briefcase, Bus, Car, Church, Clinic, Cup, Headstone, Home, Hospital, Landmark, Mail, Medical, Music, Pill, Plane, Scales, School, Shield, Sprout, Square, Stadium, Store, Tower, Train, Trees, Users, Vault, Wrench } from '../components/Icons';

type Icon = ComponentType<{ size?: number; className?: string }>;

const BY_ICON: Record<string, Icon> = {
  house: Home,
  church: Church,
  hall: Users,
  library: Book,
  cemetery: Headstone,
  school: School,
  clinic: Clinic,
  medical: Medical,
  hospital: Hospital,
  ambulance: Ambulance,
  police: Shield,
  court: Scales,
  council: Landmark,
  post: Mail,
  govt: Landmark,
  shop: Store,
  market: Basket,
  deli: Cup,
  pharmacy: Pill,
  mall: Bag,
  bank: Banknote,
  combank: Banknote,
  reservebank: Vault,
  office: Briefcase,
  towers: Tower,
  chambers: Scales,
  workshop: Wrench,
  farm: Sprout,
  taxi: Car,
  park: Trees,
  plaza: Square,
  grandpark: Trees,
  sports: Ball,
  stadium: Stadium,
  concert: Music,
  busstop: Bus,
  terminus: Bus,
  station: Train,
  plane: Plane,
};

export function iconFor(icon: string): Icon {
  return BY_ICON[icon] ?? Square;
}

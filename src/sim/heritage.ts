// Where a family comes from, by its surname: South Africa's peoples as the
// district holds them (Nguni, Sotho and Tsonga; Afrikaner and English;
// Indian; Coloured). It gives a person first names of their family's own
// (a Botha child is Johan or Annelie, a Pillay child Kumaran or Priya), and
// the 3D view the family likeness. A Christian community: biblical and
// English names run through every family.
import type { Sex } from './types';

export type Heritage = 'nguni' | 'sotho' | 'tsonga' | 'afrikaner' | 'english' | 'indian' | 'coloured';

/** Surnames of the founding families, those who come later (spouses, newcomers), and their heritage. */
export const SURNAME_HERITAGE: Record<string, Heritage> = {
  Mokoena: 'sotho', Dlamini: 'nguni', Nkosi: 'nguni', 'Van der Merwe': 'afrikaner', Botha: 'afrikaner', Sithole: 'nguni', Khumalo: 'nguni', Molefe: 'sotho', Naidoo: 'indian', Petersen: 'coloured',
  Mahlangu: 'nguni', Smith: 'english', Mthembu: 'nguni', Ndlovu: 'nguni', Pretorius: 'afrikaner', 'Le Roux': 'afrikaner', Maluleke: 'tsonga', Zulu: 'nguni', Modise: 'sotho', Jacobs: 'coloured',
  Mabaso: 'nguni', Sibiya: 'nguni', Coetzee: 'afrikaner', Adams: 'coloured', Mokwena: 'sotho', Radebe: 'nguni', Pillay: 'indian', Mnguni: 'nguni', Mashaba: 'tsonga', Fourie: 'afrikaner',
  Govender: 'indian', Moodley: 'indian', Reddy: 'indian', Chetty: 'indian', Naicker: 'indian', Padayachee: 'indian',
  Williams: 'english', Taylor: 'english',
  Mabena: 'nguni', Ngwenya: 'nguni', Steyn: 'afrikaner', Maseko: 'nguni', Kruger: 'afrikaner', Tshabalala: 'nguni', Nel: 'afrikaner', Mokgadi: 'sotho', Booysen: 'coloured', Mthethwa: 'nguni',
  'Du Plessis': 'afrikaner', Lekota: 'sotho', Hlongwane: 'nguni', Swanepoel: 'afrikaner', Nyathi: 'nguni', Motaung: 'sotho', Vilakazi: 'nguni', Erasmus: 'afrikaner', Mabuza: 'nguni', Chauke: 'tsonga',
};

export function heritageOf(surname: string): Heritage {
  return SURNAME_HERITAGE[surname.replace(/ household$/, '')] ?? 'nguni';
}

/** First names by heritage and sex. */
export const FIRST_NAMES: Record<Heritage, Record<Sex, string[]>> = {
  nguni: {
    M: ['Sipho', 'Bongani', 'Mandla', 'Themba', 'Lwazi', 'Siyabonga', 'Ayanda', 'Lungelo', 'Vusi', 'Jabu', 'Sibusiso', 'Nkosinathi', 'Sifiso', 'Thulani', 'Samuel', 'Daniel', 'Joseph', 'Elijah', 'Isaac', 'Peter'],
    F: ['Nomvula', 'Zanele', 'Thandi', 'Ayanda', 'Zinhle', 'Nokuthula', 'Amahle', 'Lindiwe', 'Sibongile', 'Thandeka', 'Nompumelelo', 'Zodwa', 'Precious', 'Blessing', 'Faith', 'Grace', 'Esther', 'Ruth', 'Hope', 'Mary'],
  },
  sotho: {
    M: ['Thabo', 'Kagiso', 'Tumelo', 'Lesedi', 'Katlego', 'Tshepo', 'Neo', 'Karabo', 'Mpho', 'Kabelo', 'Teboho', 'Lebohang', 'Tebogo', 'Pule', 'Samuel', 'David', 'Joseph', 'Paul'],
    F: ['Naledi', 'Lerato', 'Refilwe', 'Palesa', 'Boitumelo', 'Nthabiseng', 'Dineo', 'Bontle', 'Keabetswe', 'Tumi', 'Puleng', 'Mpho', 'Dimakatso', 'Grace', 'Joy', 'Faith', 'Esther', 'Sarah'],
  },
  tsonga: {
    M: ['Hlulani', 'Rhulani', 'Vutomi', 'Tiyani', 'Nyiko', 'Tsakani', 'Themba', 'Hlengani', 'Samuel', 'Elijah', 'Joseph'],
    F: ['Tsakani', 'Nyiko', 'Rirhandzu', 'Nsovo', 'Ntsako', 'Tintswalo', 'Hlulani', 'Grace', 'Esther', 'Faith', 'Ruth'],
  },
  afrikaner: {
    M: ['Johan', 'Pieter', 'Ruan', 'Willem', 'Francois', 'Stefan', 'Jaco', 'Hendrik', 'Gerhard', 'Christo', 'Wian', 'Dewald', 'Daniel', 'Samuel'],
    F: ['Annelie', 'Marike', 'Elmarie', 'Lize', 'Chantel', 'Karin', 'Riana', 'Anika', 'Mariska', 'Elsabe', 'Liezl', 'Hannah', 'Anna', 'Esther'],
  },
  english: {
    M: ['Peter', 'David', 'Andrew', 'Simon', 'Paul', 'Ethan', 'Caleb', 'Nathan', 'James', 'Matthew', 'Luke', 'Daniel', 'Samuel', 'Isaac'],
    F: ['Sarah', 'Hannah', 'Rebecca', 'Emma', 'Jessica', 'Megan', 'Lauren', 'Claire', 'Anna', 'Lydia', 'Ruth', 'Miriam', 'Grace', 'Joy'],
  },
  indian: {
    M: ['Kumaran', 'Selvan', 'Rajen', 'Ashwin', 'Nishan', 'Dinesh', 'Suren', 'Prakash', 'Logan', 'Kevin', 'Vernon', 'Jonathan', 'Samuel', 'Daniel'],
    F: ['Priya', 'Kavitha', 'Shanthi', 'Anusha', 'Sharmila', 'Prishani', 'Nerisha', 'Kamini', 'Leela', 'Denisha', 'Esther', 'Grace', 'Ruth', 'Sarah'],
  },
  coloured: {
    M: ['Clint', 'Shaun', 'Ricardo', 'Ashley', 'Wayne', 'Marlon', 'Jason', 'Brandon', 'Chad', 'Dylan', 'Nathan', 'Daniel', 'Isaac'],
    F: ['Chantelle', 'Charmaine', 'Natasha', 'Shireen', 'Lee-Ann', 'Candice', 'Monique', 'Bianca', 'Faith', 'Grace', 'Joy', 'Hannah'],
  },
};

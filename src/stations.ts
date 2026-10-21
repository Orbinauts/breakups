/**
 * The launches of the crewed stations, by designator: what a station sheds
 * (tools, covers, tanks, bags) is released on purpose and catalogued as
 * debris under its launch, so its pieces confirm nothing and attribute
 * nothing (`stationLaunches` in `params.ts`). From the satellite
 * catalogue's names: the stations in orbit since the earliest replayed
 * year (1994, `scripts/archive/years.ts`), the bodies it names MIR, ISS,
 * TIANGONG and CSS, each by the launch of its own designator. Mir and its
 * modules Kvant 1, Kvant 2, Kristall, Spektr and Priroda, in orbit to
 * 2001, were added for the fresh validation (the thirteenth decision
 * record) and change no verdict from 2005 on: none of those launches has a
 * body in orbit then. The International Space Station's Zarya, Unity,
 * Zvezda, Destiny, Poisk and Nauka; Tiangong-1 and -2; the Chinese
 * station's Tianhe, Wentian and Mengtian. Unity and Destiny flew up in a
 * Shuttle, so their launches are a Shuttle's too: the visiting-craft list
 * (`visiting.ts`) leaves a station's launch out, since this rule refuses
 * every body of it, the craft's rocket body as well.
 */
export const STATION_LAUNCHES: readonly string[] = [
  "1986-017", // Mir
  "1987-030", // Kvant 1
  "1989-093", // Kvant 2
  "1990-048", // Kristall
  "1995-024", // Spektr
  "1996-023", // Priroda
  "1998-067", // ISS (Zarya)
  "1998-069", // ISS (Unity), with STS 88
  "2000-037", // ISS (Zvezda)
  "2001-006", // ISS (Destiny), with STS 98
  "2009-060", // ISS (Poisk)
  "2021-066", // ISS (Nauka)
  "2011-053", // Tiangong-1
  "2016-057", // Tiangong-2
  "2021-035", // CSS (Tianhe)
  "2022-085", // CSS (Wentian)
  "2022-143", // CSS (Mengtian)
];

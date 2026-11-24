/**
 * Déclarations de modules pour les données géographiques embarquées.
 *
 * Les fichiers `.geojson` sont importés directement (Webpack/Next sait les
 * résoudre en JSON), mais TypeScript exige une déclaration explicite.
 * Sans elle, l'import est une erreur de compilation — et non un simple
 * avertissement, car `strict` est actif.
 */

declare module "*.geojson" {
  const value: unknown;
  export default value;
}

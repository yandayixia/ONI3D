#Feature: map layers & procedural foliage

##Goal
Implement procedural foliage to existing map logic in the form of tile decoration, which is another pass of the drawing canvas that adds to existing map data.

##Requirements:
- Adds another pass after intial terrain data generation that draws many layer of details at specific layers based on  theirdetail layer index. 

- New layered world rendering system (layers are drawn in ascending order; UI overlays such as selection, hover and dig markers are drawn after all layers):
    - layer 0~9: Reserved for unspecified future use.
    - layer 10~19: background.
        - layer 10: procedural cave wall texture (drawn first), then background flowers on top of it.
        - layer 11~19: reserved.
    - layer 20: The current terrain tile set (base colour, plus the surface colour band on exposed tiles).
    - layer 21~29: additional terrain tile set decoration
        - layer 21: terrain pixel noise.
        - layer 22: grass.
        - layer 23: hanging vines.
        - layer 24: floor moss and ceiling moss.
        - layer 25: the colonists are drawn here (moved from layer 30), together with their planned path lines.
        - layer 26: water tiles. Special case: drawn above the colonists so they look submerged.
        - layer 27~29: reserved.
    - layer 30: reserved (previously colonists).
    - layer 31~39: foreground foliage texture
        - layer 31: foreground flowers.
        - layer 32~39: reserved.
    - layer 40~49: reserved for unspecified future use.

- the terrain tiles are now procedural with the specified rules:
	- each tile is current a 4 x 4 grid when rendered. promote it to 32 x 32.
	- dirt tile: base color rgb(137, 94, 58), surface variance rgb(184, 129, 84), with a pixel noise variance of 15% saturation, 20 % brightness, and 1% hue.
	- rock tile: base color rgb(111, 115, 126), surface variance rgb(151, 156, 167), with a pixel noise variance of 12% saturation, 7 % brigtness, and 5% hue.
	- water: base color rgb(75, 134, 206), surface variance rgb(127, 182, 238), with a pixel noise variance of 5% saturation, 3% brigtness, 2% hue.
	- all the base color are drawn at layer 20
	- pixel noise are drawn as decoration at layer 21.
	- special rule: for all three tiles, if the tile has an empty tile above it, replace the top 8 row of the tile's base color with the special surface variance at layer 20. and reduce the opacity for the top 8 row of the corresponding layer 21 to 50%. 

- 6 types of foliage:
	- Ceiling moss: drawn at layer 24, dark greenish color Web like shape covering bottom 50%~20% of the tile it is growing on, as well as taking the top 10% ~ 20% of the tile below it.
	- Floor moss: drawn at layer 24, greenish color, grow 1 tile at rock and dirt tiles, covering the top 1~7 row of pixel of its tile, as well as taking the bottom 1% ~ 10% of the tile above it.
	- Hanging vine: draw at layer 23, green with pixel of spikes (white hue). a vine can be 1 ~ 5 tile tall, must blends smoothly with ceiling moss it is connected to. plays a swing wiggle animation when cololnist enter/exists it based on movement direction respecting physics.
	- Grass: draw at layer 22, different shades of strokes of green. grass patches are 0.15~ 0.4 tile tall, must blends smoothly with floor moss it is connected to. plays a minor wiggle animation when cololnist enter/exists it regardless of motion direction.
	- Background flower: drawn at layer 10, 10% ~ 40% of colonist height at base, 10% size instance variance ontop. Has a darker color center than rest of the flower, color randomized. has a shaft that connects to the grass it is growing on. has 0~3 leafs along both sides of the shaft.
	- Foreground flower: drawn at layer 31, 30% ~ 55% of colonist height at base, 15% size instance variance ontop. Has a lighter color center than rest of the flower, color randomized. has a shaft that connects to the grass it is growing on. has 1~5 leafs along both sides of the shaft.
	- none of the foliage affects path finding in any way. 
- foliage spawn pass & rule:
	-the foliage are stored as another 200 x 200 enum "foliage array" besides the "base terrain array". 
	-the foliage array can be:
		- empty
		- floor moss
		- ceiling moss
		- hanging vine
		- grass
	- note that foreground & background flower as not stored in the foliage array.
	-step 1: "Floor moss pass“
		-For every rock tile that has 1 empty tile above it, theres 15% chance it has floor moss. Chance bumped to 80% if there's any water tile with 20 tiles.
		-For every dirt tile, if it has 1 empty tile above it, and it is one dirt tile on its immediate left & right, it has floor moss.
	-step 2: "ceiling moss pass"
		-For every rock tile that has 1 empty tile below it, there's 15% chance it has ceiling moss. chance bumped to 80%  if there's any water tile with 20 tiles.
		-for every dirt tile, that has 1 empty tile below it, and there it is one dirt tile on its immediate left & right, it has ceiling moss.
	-step 4: "grass pass"
		-For any floor moss tile, if there is another floor moss tile to its immediate left or right, there is grass growing on the tile immediately above it if it is empty.
	-step 5: "Hanging vine pass"
		-For any ceiling moss tile, there's 20% chance there's a vine growing right below it. If there is, check the lower five tiles of base terrain array and foliage array are empty or not, note down how many consecutive empty space are there as "MaxSizeVineSupported". Randomly choose a vine height of 1~"MaxSizeVineSupported" tile.
	-step 6: "Background flower pass"
		-for every grass tile in foliage arry, there's 10% chance there's background flower there as well. 
	-step 7: "foreground flower pass"
		-for every grass tile in foliage arry, there's 10% chance there's foreground flower there as well.

- terrain generation pass modification:
	- remove previous step 5, old water pit generation rule
	- instead, after step 1, add "spawn random water pit pass" as step 2: randomly select 4 cordinate, two 50 tiles above map center and two 50 tiles below map center, at each corrdiate place water clusters of width (15~ 25), height (4~8). The four edge tiles of the water rect must then be modified, moving along the normal of side (-1~1）tile at random. Save This process as "edge jagging process" for futre use.
	- the previous step 2, now called "dig cave pass" as step 3.
	- the previous step 3, now called "dirt to rock pass" as step 4.
	- the previous step 4, now called "spawn point pass" as step 5. apply the same edge jagging method in step 2 to top, left, right edge of the spawn box. Additionally, pick a direction, left or right at random, track it as "dominante side".
	- add step 6, "spawn starting pond pass", Place one 10×4 water clusters at roughly the same elevation (2 tiles height variance from spawn platform) (20~ 30) tiles besides the spawn point at the previous chosen "dominante side".

##Constratins
- maintain current colonist per terrain tile on screen size ratio.
- perserve current terrain generation pass unless exclusively specified
- avoid unrelated refactoring 

##Accept Criteria
- background foliage and foregorund foliage doesn't result in flickering 
- each generation attempt complets under 1 second
- procedurally generated foliage ressembles pixel art vine/grass/flower
- tests cover failure cases

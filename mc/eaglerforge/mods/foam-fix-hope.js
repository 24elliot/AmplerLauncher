(function() {
    ModAPI.meta.title("FoamFix Remake");
    ModAPI.meta.description("A collection of performance improvements inspired by FoamFix.");
    ModAPI.meta.author("Your Name");

    // ================================================================================= //
    // --- Model Deduplication ---
    // This is the core feature of FoamFix. It significantly reduces RAM usage by finding
    // duplicate block and item models and replacing them with a single instance.
    // ================================================================================= //

    const modelCache = new Map();
    let modelsDeduplicated = 0;

    // We need a way to create a unique "signature" or hash for each model.
    // This function converts the essential parts of a model into a JSON string.
    function getModelSignature(model) {
        try {
            const signature = {
                // General quads
                general: model.getGeneralQuads().map(quad => quad.getVertexData().join(',')),
                // Face-specific quads
                faces: Object.fromEntries(
                    model.getFaceQuads().map(([face, quads]) => [
                        face,
                        quads.map(quad => quad.getVertexData().join(','))
                    ])
                ),
                // Other model properties
                ambientOcclusion: model.isAmbientOcclusion(),
                gui3d: model.isGui3d(),
                builtInRenderer: model.isBuiltInRenderer(),
            };
            return JSON.stringify(signature);
        } catch (e) {
            // Some models might not be compatible; we'll skip them.
            return null;
        }
    }

    // We hook into the ModelBakery, which is responsible for baking raw models into a format the game can use.
    // This is the perfect place to intercept the models and deduplicate them.
    const bakeModel = ModAPI.util.getMethodFromPackage("net.minecraft.client.resources.model.ModelBakery", "bakeModel");
    const originalBakeModel = ModAPI.hooks.methods[bakeModel];
    ModAPI.hooks.methods[bakeModel] = function(model, transform) {
        // First, let the original game code bake the model.
        const bakedModel = originalBakeModel.call(this, model, transform);

        // Now, generate a signature for the newly baked model.
        const signature = getModelSignature(bakedModel);
        if (signature === null) {
            return bakedModel; // Can't process this model, return as-is.
        }

        // Check if we've already seen a model with this exact signature.
        if (modelCache.has(signature)) {
            modelsDeduplicated++;
            // If we have, return the cached model instead of this new, duplicate one.
            return modelCache.get(signature);
        } else {
            // If this is a new, unique model, add it to our cache.
            modelCache.set(signature, bakedModel);
            return bakedModel;
        }
    };
    
    // Log the results to the console after the game has loaded.
    ModAPI.events.register("update", () => {
        if (ModAPI.minecraft.theWorld && ModAPI.minecraft.thePlayer) {
            console.log(`[FoamFix Remake] Deduplicated ${modelsDeduplicated} models.`);
            // Unregister the event so it only runs once.
            ModAPI.events.unregister("update");
        }
    });


    // ================================================================================= //
    // --- Other Optimizations (from previous steps) ---
    // ================================================================================= //

    // A unique symbol to store our cache on the ClassInheritanceMultiMap instance
    const cacheSymbol = Symbol("foamfix_cache");

    // --- Faster Entity Lookup ---
    const CIMM_constructor = ModAPI.util.getConstructorFromPackage("net.minecraft.util.ClassInheritanceMultiMap");
    const original_CIMM_constructor = ModAPI.hooks.constructors[CIMM_constructor];
    ModAPI.hooks.constructors[CIMM_constructor] = function(...args) {
        original_CIMM_constructor.call(this, ...args);
        this[cacheSymbol] = new Map();
    };

    const CIMM_add = ModAPI.util.getMethodFromPackage("net.minecraft.util.ClassInheritanceMultiMap", "add");
    const original_CIMM_add = ModAPI.hooks.methods[CIMM_add];
    ModAPI.hooks.methods[CIMM_add] = function(...args) {
        this[cacheSymbol]?.clear();
        return original_CIMM_add.call(this, ...args);
    };

    const CIMM_remove = ModAPI.util.getMethodFromPackage("net.minecraft.util.ClassInheritanceMultiMap", "remove");
    const original_CIMM_remove = ModAPI.hooks.methods[CIMM_remove];
    ModAPI.hooks.methods[CIMM_remove] = function(...args) {
        this[cacheSymbol]?.clear();
        return original_CIMM_remove.call(this, ...args);
    };
    
    const CIMM_getByClass = ModAPI.util.getMethodFromPackage("net.minecraft.util.ClassInheritanceMultiMap", "getByClass");
    const original_CIMM_getByClass = ModAPI.hooks.methods[CIMM_getByClass];
    ModAPI.hooks.methods[CIMM_getByClass] = function(classToGet) {
        const cache = this[cacheSymbol];
        if (cache?.has(classToGet)) {
            return cache.get(classToGet);
        } else {
            const result = original_CIMM_getByClass.call(this, classToGet);
            cache?.set(classToGet, result);
            return result;
        }
    };

    // --- Disable Redstone Light ---
    const getLightValue = ModAPI.util.getMethodFromPackage("net.minecraft.block.Block", "getLightValue");
    const originalGetLightValue = ModAPI.hooks.methods[getLightValue];
    ModAPI.hooks.methods[getLightValue] = function(state) {
        const block = state.getBlock();
        const blockName = block.getUnlocalizedName();
        if (blockName === "tile.torch" || blockName === "tile.repeater" || blockName === "tile.comparator") {
            const blockState = block.getMetaFromState(state);
            if ((blockName === "tile.torch" && blockState === 5) || (blockName !== "tile.torch" && (blockState & 8) !== 0)) {
                return 0;
            }
        }
        return originalGetLightValue.call(this, state);
    };

    // --- Faster Hopper ---
    const updateHopper = ModAPI.util.getMethodFromPackage("net.minecraft.tileentity.TileEntityHopper", "update");
    const originalUpdateHopper = ModAPI.hooks.methods[updateHopper];
    ModAPI.hooks.methods[updateHopper] = function() {
        if (this.transferCooldown > 0) {
            this.transferCooldown--;
        } else {
            this.transferCooldown = 8;
            originalUpdateHopper.call(this);
        }
    };

    // --- Disable Texture Animations ---
    const updateAnimation = ModAPI.util.getMethodFromPackage("net.minecraft.client.renderer.texture.TextureAtlasSprite", "updateAnimation");
    ModAPI.hooks.methods[updateAnimation] = () => {};

})();

import type {
    AsyncExactReadable,
    ExactReadable,
    StructFieldDefinition,
    StructFieldValue,
    StructOptions,
} from "./basic/index.js";
import {
    ExactReadableEndedError,
    STRUCT_VALUE_SYMBOL,
    StructDefaultOptions,
    StructValue,
} from "./basic/index.js";
import { SyncPromise } from "./sync-promise.js";
import type {
    BufferFieldSubType,
    FixedLengthBufferLikeFieldOptions,
    LengthField,
    VariableLengthBufferLikeFieldOptions,
} from "./types/index.js";
import {
    BigIntFieldDefinition,
    BigIntFieldType,
    FixedLengthBufferLikeFieldDefinition,
    NumberFieldDefinition,
    NumberFieldType,
    StringBufferFieldSubType,
    Uint8ArrayBufferFieldSubType,
    VariableLengthBufferLikeFieldDefinition,
} from "./types/index.js";
import type { Evaluate, Identity, Overwrite, ValueOrPromise } from "./utils.js";

export interface StructLike<TValue> {
    deserialize(stream: ExactReadable | AsyncExactReadable): Promise<TValue>;
}

/**
 * Extract the value type of the specified `Struct`
 */
export type StructValueType<T extends StructLike<unknown>> = Awaited<
    ReturnType<T["deserialize"]>
>;

/**
 * Create a new `Struct` type with `TDefinition` appended
 */
type AddFieldDescriptor<
    TFields extends object,
    TOmitInitKey extends PropertyKey,
    TExtra extends object,
    TPostDeserialized,
    TFieldName extends PropertyKey,
    TDefinition extends StructFieldDefinition<any, any, any>
> = Identity<
    Struct<
        // Merge two types
        // Evaluate immediately to optimize editor hover tooltip
        Evaluate<TFields & Record<TFieldName, TDefinition["TValue"]>>,
        // Merge two `TOmitInitKey`s
        TOmitInitKey | TDefinition["TOmitInitKey"],
        TExtra,
        TPostDeserialized
    >
>;

/**
 * Overload methods to add an array buffer like field
 */
interface ArrayBufferLikeFieldCreator<
    TFields extends object,
    TOmitInitKey extends PropertyKey,
    TExtra extends object,
    TPostDeserialized
> {
    /**
     * Append a fixed-length array buffer like field to the `Struct`
     *
     * @param name Name of the field
     * @param type `Array.SubType.ArrayBuffer` or `Array.SubType.String`
     * @param options Fixed-length array options
     * @param typeScriptType Type of the field in TypeScript.
     * For example, if this field is a string, you can declare it as a string enum or literal union.
     */
    <
        TName extends PropertyKey,
        TType extends BufferFieldSubType<any, any>,
        TTypeScriptType = TType["TTypeScriptType"]
    >(
        name: TName,
        type: TType,
        options: FixedLengthBufferLikeFieldOptions,
        typeScriptType?: TTypeScriptType
    ): AddFieldDescriptor<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        TName,
        FixedLengthBufferLikeFieldDefinition<
            TType,
            FixedLengthBufferLikeFieldOptions
        >
    >;

    /**
     * Append a variable-length array buffer like field to the `Struct`
     */
    <
        TName extends PropertyKey,
        TType extends BufferFieldSubType<any, any>,
        TOptions extends VariableLengthBufferLikeFieldOptions<TFields>,
        TTypeScriptType = TType["TTypeScriptType"]
    >(
        name: TName,
        type: TType,
        options: TOptions,
        typeScriptType?: TTypeScriptType
    ): AddFieldDescriptor<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        TName,
        VariableLengthBufferLikeFieldDefinition<TType, TOptions>
    >;
}

/**
 * Similar to `ArrayBufferLikeFieldCreator`, but bind to `TType`
 */
interface BoundArrayBufferLikeFieldDefinitionCreator<
    TFields extends object,
    TOmitInitKey extends PropertyKey,
    TExtra extends object,
    TPostDeserialized,
    TType extends BufferFieldSubType<any, any>
> {
    <TName extends PropertyKey, TTypeScriptType = TType["TTypeScriptType"]>(
        name: TName,
        options: FixedLengthBufferLikeFieldOptions,
        typeScriptType?: TTypeScriptType
    ): AddFieldDescriptor<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        TName,
        FixedLengthBufferLikeFieldDefinition<
            TType,
            FixedLengthBufferLikeFieldOptions,
            TTypeScriptType
        >
    >;

    <
        TName extends PropertyKey,
        TLengthField extends LengthField<TFields>,
        TOptions extends VariableLengthBufferLikeFieldOptions<
            TFields,
            TLengthField
        >,
        TTypeScriptType = TType["TTypeScriptType"]
    >(
        name: TName,
        options: TOptions,
        typeScriptType?: TTypeScriptType
    ): AddFieldDescriptor<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        TName,
        VariableLengthBufferLikeFieldDefinition<
            TType,
            TOptions,
            TTypeScriptType
        >
    >;
}

export type StructPostDeserialized<TFields, TPostDeserialized> = (
    this: TFields,
    object: TFields
) => TPostDeserialized;

export type StructDeserializedResult<
    TFields extends object,
    TExtra extends object,
    TPostDeserialized
> = TPostDeserialized extends undefined
    ? Overwrite<TExtra, TFields>
    : TPostDeserialized;

export class StructDeserializeError extends Error {
    public constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class StructNotEnoughDataError extends StructDeserializeError {
    public constructor() {
        super(
            "The underlying readable was ended before the struct was fully deserialized"
        );
    }
}

export class StructEmptyError extends StructDeserializeError {
    public constructor() {
        super("The underlying readable doesn't contain any more struct");
    }
}

export class Struct<
    TFields extends object = Record<never, never>,
    TOmitInitKey extends PropertyKey = never,
    TExtra extends object = Record<never, never>,
    TPostDeserialized = undefined
> implements
        StructLike<
            StructDeserializedResult<TFields, TExtra, TPostDeserialized>
        >
{
    public readonly TFields!: TFields;

    public readonly TOmitInitKey!: TOmitInitKey;

    public readonly TExtra!: TExtra;

    public readonly TInit!: Evaluate<Omit<TFields, TOmitInitKey>>;

    public readonly TDeserializeResult!: StructDeserializedResult<
        TFields,
        TExtra,
        TPostDeserialized
    >;

    public readonly options: Readonly<StructOptions>;

    #size = 0;
    /**
     * Gets the static size (exclude fields that can change size at runtime)
     */
    public get size() {
        return this.#size;
    }

    #fields: [
        name: PropertyKey,
        definition: StructFieldDefinition<any, any, any>
    ][] = [];

    #extra: Record<PropertyKey, unknown> = {};

    #postDeserialized?: StructPostDeserialized<any, any> | undefined;

    public constructor(options?: Partial<Readonly<StructOptions>>) {
        this.options = { ...StructDefaultOptions, ...options };
    }

    /**
     * Appends a `StructFieldDefinition` to the `Struct
     */
    public field<
        TName extends PropertyKey,
        TDefinition extends StructFieldDefinition<any, any, any>
    >(
        name: TName,
        definition: TDefinition
    ): AddFieldDescriptor<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        TName,
        TDefinition
    > {
        for (const field of this.#fields) {
            if (field[0] === name) {
                // Convert Symbol to string
                const nameString = String(name);
                throw new Error(
                    `This struct already have a field with name '${nameString}'`
                );
            }
        }

        this.#fields.push([name, definition]);

        const size = definition.getSize();
        this.#size += size;

        // Force cast `this` to another type
        return this as any;
    }

    /**
     * Merges (flats) another `Struct`'s fields and extra fields into this one.
     */
    public fields<TOther extends Struct<any, any, any, any>>(
        other: TOther
    ): Struct<
        TFields & TOther["TFields"],
        TOmitInitKey | TOther["TOmitInitKey"],
        TExtra & TOther["TExtra"],
        TPostDeserialized
    > {
        for (const field of other.#fields) {
            this.#fields.push(field);
        }
        this.#size += other.#size;
        Object.defineProperties(
            this.#extra,
            Object.getOwnPropertyDescriptors(other.#extra)
        );
        return this as any;
    }

    private number<
        TName extends PropertyKey,
        TType extends NumberFieldType = NumberFieldType,
        TTypeScriptType = number
    >(name: TName, type: TType, typeScriptType?: TTypeScriptType) {
        return this.field(
            name,
            new NumberFieldDefinition(type, typeScriptType)
        );
    }

    /**
     * Appends an `int8` field to the `Struct`
     */
    public int8<TName extends PropertyKey, TTypeScriptType = number>(
        name: TName,
        typeScriptType?: TTypeScriptType
    ) {
        return this.number(name, NumberFieldType.Int8, typeScriptType);
    }

    /**
     * Appends an `uint8` field to the `Struct`
     */
    public uint8<TName extends PropertyKey, TTypeScriptType = number>(
        name: TName,
        typeScriptType?: TTypeScriptType
    ) {
        return this.number(name, NumberFieldType.Uint8, typeScriptType);
    }

    /**
     * Appends an `int16` field to the `Struct`
     */
    public int16<TName extends PropertyKey, TTypeScriptType = number>(
        name: TName,
        typeScriptType?: TTypeScriptType
    ) {
        return this.number(name, NumberFieldType.Int16, typeScriptType);
    }

    /**
     * Appends an `uint16` field to the `Struct`
     */
    public uint16<TName extends PropertyKey, TTypeScriptType = number>(
        name: TName,
        typeScriptType?: TTypeScriptType
    ) {
        return this.number(name, NumberFieldType.Uint16, typeScriptType);
    }

    /**
     * Appends an `int32` field to the `Struct`
     */
    public int32<TName extends PropertyKey, TTypeScriptType = number>(
        name: TName,
        typeScriptType?: TTypeScriptType
    ) {
        return this.number(name, NumberFieldType.Int32, typeScriptType);
    }

    /**
     * Appends an `uint32` field to the `Struct`
     */
    public uint32<TName extends PropertyKey, TTypeScriptType = number>(
        name: TName,
        typeScriptType?: TTypeScriptType
    ) {
        return this.number(name, NumberFieldType.Uint32, typeScriptType);
    }

    private bigint<
        TName extends PropertyKey,
        TType extends BigIntFieldType = BigIntFieldType,
        TTypeScriptType = TType["TTypeScriptType"]
    >(name: TName, type: TType, typeScriptType?: TTypeScriptType) {
        return this.field(
            name,
            new BigIntFieldDefinition(type, typeScriptType)
        );
    }

    /**
     * Appends an `int64` field to the `Struct`
     *
     * Requires native `BigInt` support
     */
    public int64<
        TName extends PropertyKey,
        TTypeScriptType = BigIntFieldType["TTypeScriptType"]
    >(name: TName, typeScriptType?: TTypeScriptType) {
        return this.bigint(name, BigIntFieldType.Int64, typeScriptType);
    }

    /**
     * Appends an `uint64` field to the `Struct`
     *
     * Requires native `BigInt` support
     */
    public uint64<
        TName extends PropertyKey,
        TTypeScriptType = BigIntFieldType["TTypeScriptType"]
    >(name: TName, typeScriptType?: TTypeScriptType) {
        return this.bigint(name, BigIntFieldType.Uint64, typeScriptType);
    }

    private arrayBufferLike: ArrayBufferLikeFieldCreator<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized
    > = (
        name: PropertyKey,
        type: BufferFieldSubType,
        options:
            | FixedLengthBufferLikeFieldOptions
            | VariableLengthBufferLikeFieldOptions
    ): any => {
        if ("length" in options) {
            return this.field(
                name,
                new FixedLengthBufferLikeFieldDefinition(type, options)
            );
        } else {
            return this.field(
                name,
                new VariableLengthBufferLikeFieldDefinition(type, options)
            );
        }
    };

    public uint8Array: BoundArrayBufferLikeFieldDefinitionCreator<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        Uint8ArrayBufferFieldSubType
    > = (name: PropertyKey, options: any, typeScriptType: any): any => {
        return this.arrayBufferLike(
            name,
            Uint8ArrayBufferFieldSubType.Instance,
            options,
            typeScriptType
        );
    };

    public string: BoundArrayBufferLikeFieldDefinitionCreator<
        TFields,
        TOmitInitKey,
        TExtra,
        TPostDeserialized,
        StringBufferFieldSubType
    > = (name: PropertyKey, options: any, typeScriptType: any): any => {
        return this.arrayBufferLike(
            name,
            StringBufferFieldSubType.Instance,
            options,
            typeScriptType
        );
    };

    /**
     * Adds some extra properties into every `Struct` value.
     *
     * Extra properties will not affect serialize or deserialize process.
     *
     * Multiple calls to `extra` will merge all properties together.
     *
     * @param value
     * An object containing properties to be added to the result value. Accessors and methods are also allowed.
     */
    public extra<
        T extends Record<
            // This trick disallows any keys that are already in `TValue`
            Exclude<keyof T, Exclude<keyof T, keyof TFields>>,
            never
        >
    >(
        value: T & ThisType<Overwrite<Overwrite<TExtra, T>, TFields>>
    ): Struct<TFields, TOmitInitKey, Overwrite<TExtra, T>, TPostDeserialized> {
        Object.defineProperties(
            this.#extra,
            Object.getOwnPropertyDescriptors(value)
        );
        return this as any;
    }

    /**
     * Registers (or replaces) a custom callback to be run after deserialized.
     *
     * A callback returning `never` (always throw an error)
     * will also change the return type of `deserialize` to `never`.
     */
    public postDeserialize(
        callback: StructPostDeserialized<TFields, never>
    ): Struct<TFields, TOmitInitKey, TExtra, never>;
    /**
     * Registers (or replaces) a custom callback to be run after deserialized.
     *
     * A callback returning `void` means it modify the result object in-place
     * (or doesn't modify it at all), so `deserialize` will still return the result object.
     */
    public postDeserialize(
        callback?: StructPostDeserialized<TFields, void>
    ): Struct<TFields, TOmitInitKey, TExtra, undefined>;
    /**
     * Registers (or replaces) a custom callback to be run after deserialized.
     *
     * A callback returning anything other than `undefined`
     * will `deserialize` to return that object instead.
     */
    public postDeserialize<TPostSerialize>(
        callback?: StructPostDeserialized<TFields, TPostSerialize>
    ): Struct<TFields, TOmitInitKey, TExtra, TPostSerialize>;
    public postDeserialize(callback?: StructPostDeserialized<TFields, any>) {
        this.#postDeserialized = callback;
        return this as any;
    }

    /**
     * Deserialize a struct value from `stream`.
     */
    public deserialize(
        stream: ExactReadable
    ): StructDeserializedResult<TFields, TExtra, TPostDeserialized>;
    public deserialize(
        stream: AsyncExactReadable
    ): Promise<StructDeserializedResult<TFields, TExtra, TPostDeserialized>>;
    public deserialize(
        stream: ExactReadable | AsyncExactReadable
    ): ValueOrPromise<
        StructDeserializedResult<TFields, TExtra, TPostDeserialized>
    > {
        const structValue = new StructValue(this.#extra);

        let promise = SyncPromise.resolve();

        const startPosition = stream.position;
        for (const [name, definition] of this.#fields) {
            promise = promise
                .then(() =>
                    definition.deserialize(this.options, stream, structValue)
                )
                .then(
                    (fieldValue) => {
                        structValue.set(name, fieldValue);
                    },
                    (e) => {
                        if (!(e instanceof ExactReadableEndedError)) {
                            throw e;
                        }

                        if (stream.position === startPosition) {
                            throw new StructEmptyError();
                        } else {
                            throw new StructNotEnoughDataError();
                        }
                    }
                );
        }

        return promise
            .then(() => {
                const value = structValue.value;

                // Run `postDeserialized`
                if (this.#postDeserialized) {
                    const override = this.#postDeserialized.call(value, value);
                    // If it returns a new value, use that as result
                    // Otherwise it only inspects/mutates the object in place.
                    if (override !== undefined) {
                        return override;
                    }
                }

                return value;
            })
            .valueOrPromise();
    }

    public serialize(init: Evaluate<Omit<TFields, TOmitInitKey>>): Uint8Array;
    public serialize(
        init: Evaluate<Omit<TFields, TOmitInitKey>>,
        output: Uint8Array
    ): number;
    public serialize(
        init: Evaluate<Omit<TFields, TOmitInitKey>>,
        output?: Uint8Array
    ): Uint8Array | number {
        let structValue: StructValue;
        if (STRUCT_VALUE_SYMBOL in init) {
            structValue = (init as any)[STRUCT_VALUE_SYMBOL];
            for (const [key, value] of Object.entries(init)) {
                const fieldValue = structValue.get(key);
                if (fieldValue) {
                    fieldValue.set(value);
                }
            }
        } else {
            structValue = new StructValue({});
            for (const [name, definition] of this.#fields) {
                const fieldValue = definition.create(
                    this.options,
                    structValue,
                    (init as any)[name]
                );
                structValue.set(name, fieldValue);
            }
        }

        let structSize = 0;
        const fieldsInfo: { fieldValue: StructFieldValue; size: number }[] = [];

        for (const [name] of this.#fields) {
            const fieldValue = structValue.get(name);
            const size = fieldValue.getSize();
            fieldsInfo.push({ fieldValue, size });
            structSize += size;
        }

        let outputType = "number";
        if (!output) {
            output = new Uint8Array(structSize);
            outputType = "Uint8Array";
        }

        const dataView = new DataView(
            output.buffer,
            output.byteOffset,
            output.byteLength
        );
        let offset = 0;
        for (const { fieldValue, size } of fieldsInfo) {
            fieldValue.serialize(dataView, offset);
            offset += size;
        }

        if (outputType === "number") {
            return structSize;
        } else {
            return output;
        }
    }
}
